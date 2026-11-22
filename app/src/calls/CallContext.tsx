/**
 * Call state machine for the whole app.
 *
 *   idle ──startCall──► outgoing ──(call:accepted)──► active ──► ended ──► idle
 *   idle ──(call:incoming)──► incoming ──accept──► (call:accepted) ──► active
 *                                     └─reject──► ended
 *
 * The server is the source of truth: we send actions with acknowledgements
 * (call:invite / accept / reject / end) and move between phases only when the
 * server confirms or pushes an event (call:incoming / accepted / ended).
 * <CallOverlay/> renders the right screen for the current phase on top of
 * whatever screen the user is on.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform, Vibration } from 'react-native';

import type { CallKind, CallStatus, UserPublic } from '../api/types';
import { useSocket } from '../realtime/SocketContext';

export type CallState =
  | { phase: 'idle' }
  | { phase: 'outgoing'; peer: UserPublic; kind: CallKind; callId?: string }
  | { phase: 'incoming'; peer: UserPublic; kind: CallKind; callId: string }
  | { phase: 'active'; peer: UserPublic; kind: CallKind; callId: string; livekitUrl: string; token: string; startedAt: number }
  | { phase: 'ended'; peer: UserPublic; kind: CallKind; status: CallStatus | 'FAILED'; message: string };

interface Ack {
  ok: boolean;
  code?: string;
  message?: string;
  call_id?: string;
}

interface CallValue {
  state: CallState;
  /** Increments whenever a call finishes, so the Calls tab can refresh. */
  historyVersion: number;
  startCall: (peer: UserPublic, kind: CallKind) => Promise<void>;
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  hangup: () => Promise<void>;
}

const CallContext = createContext<CallValue | null>(null);

const RING_PATTERN = [0, 800, 1200]; // vibrate 0.8 s, pause 1.2 s, repeat

const ENDED_TEXT: Record<string, string> = {
  COMPLETED: 'Call ended',
  REJECTED: 'Call declined',
  MISSED: 'No answer',
  CANCELLED: 'Call cancelled',
};

export async function ensureCallPermissions(kind: CallKind): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  type AndroidPermission = (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS];
  const wanted: AndroidPermission[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (kind === 'VIDEO') wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocket();
  const [state, setState] = useState<CallState>({ phase: 'idle' });
  const [historyVersion, setHistoryVersion] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showEnded = useCallback((peer: UserPublic, kind: CallKind, status: CallStatus | 'FAILED', message: string) => {
    setState({ phase: 'ended', peer, kind, status, message });
    setHistoryVersion((v) => v + 1);
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = setTimeout(() => setState({ phase: 'idle' }), 1800);
  }, []);

  // Vibrate while an incoming call is ringing.
  useEffect(() => {
    if (state.phase === 'incoming') Vibration.vibrate(RING_PATTERN, true);
    else Vibration.cancel();
    return () => Vibration.cancel();
  }, [state.phase]);

  // Server → app events.
  useEffect(() => {
    if (!socket) return;

    const onIncoming = (d: { call_id: string; kind: CallKind; caller: UserPublic }) => {
      if (stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'ended') {
        socket.emit('call:reject', { call_id: d.call_id }); // already on a call screen
        return;
      }
      if (endTimer.current) clearTimeout(endTimer.current);
      setState({ phase: 'incoming', peer: d.caller, kind: d.kind, callId: d.call_id });
    };

    const onAccepted = (d: { call_id: string; kind: CallKind; livekit_url: string; token: string; peer: UserPublic }) => {
      setState({ phase: 'active', peer: d.peer, kind: d.kind, callId: d.call_id, livekitUrl: d.livekit_url, token: d.token, startedAt: Date.now() });
    };

    const onEnded = (d: { call_id: string; status: CallStatus }) => {
      const s = stateRef.current;
      if (s.phase === 'idle' || s.phase === 'ended') return;
      if ('callId' in s && s.callId && s.callId !== d.call_id) return; // stale event
      showEnded(s.peer, s.kind, d.status, ENDED_TEXT[d.status] ?? 'Call ended');
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:ended', onEnded);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:ended', onEnded);
    };
  }, [socket, showEnded]);

  const send = useCallback(
    async (event: string, payload: object): Promise<Ack> => {
      if (!socket?.connected) return { ok: false, code: 'OFFLINE_SELF', message: "You're offline. Check your connection." };
      try {
        return await socket.timeout(10000).emitWithAck(event, payload);
      } catch {
        return { ok: false, code: 'TIMEOUT', message: 'The server did not respond. Try again.' };
      }
    },
    [socket],
  );

  const startCall = useCallback(
    async (peer: UserPublic, kind: CallKind) => {
      if (stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'ended') return;
      if (!(await ensureCallPermissions(kind))) {
        Alert.alert('Permission needed', `Allow microphone${kind === 'VIDEO' ? ' and camera' : ''} access to make calls.`);
        return;
      }
      if (endTimer.current) clearTimeout(endTimer.current);
      setState({ phase: 'outgoing', peer, kind });
      const ack = await send('call:invite', { to: peer.id, kind });
      if (!ack.ok) {
        showEnded(peer, kind, 'FAILED', ack.message ?? 'Call failed');
        return;
      }
      // Re-read the ref: the user may have pressed End while we awaited the server.
      if ((stateRef.current as CallState).phase !== 'outgoing') {
        // User pressed End before the server answered: cancel the call we just created.
        await send('call:end', { call_id: ack.call_id });
        return;
      }
      setState((s) => (s.phase === 'outgoing' ? { ...s, callId: ack.call_id } : s));
    },
    [send, showEnded],
  );

  const accept = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== 'incoming') return;
    Vibration.cancel();
    if (!(await ensureCallPermissions(s.kind))) {
      await send('call:reject', { call_id: s.callId });
      Alert.alert('Permission needed', 'Allow microphone and camera access to answer calls.');
      return;
    }
    const ack = await send('call:accept', { call_id: s.callId });
    if (!ack.ok) showEnded(s.peer, s.kind, 'FAILED', ack.message ?? 'Could not answer');
    // On success the server sends call:accepted, which moves us to 'active'.
  }, [send, showEnded]);

  const reject = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== 'incoming') return;
    await send('call:reject', { call_id: s.callId });
  }, [send]);

  const hangup = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase === 'outgoing' && !s.callId) {
      setState({ phase: 'idle' }); // invite still in flight; nothing to cancel yet
      return;
    }
    if ((s.phase === 'outgoing' || s.phase === 'active') && s.callId) {
      const ack = await send('call:end', { call_id: s.callId });
      // If the server already forgot the call (e.g. network drop), close locally.
      if (!ack.ok && stateRef.current.phase !== 'ended') showEnded(s.peer, s.kind, 'COMPLETED', 'Call ended');
    }
  }, [send, showEnded]);

  const value = useMemo(() => ({ state, historyVersion, startCall, accept, reject, hangup }), [state, historyVersion, startCall, accept, reject, hangup]);
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCalls(): CallValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCalls must be used inside <CallProvider>');
  return ctx;
}
