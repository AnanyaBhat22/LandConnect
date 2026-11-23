/**
 * Full-screen call UI drawn above all navigation, so a call can ring or
 * continue whatever screen the user is on. One component per call phase.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
} from '@livekit/react-native';
import { ConnectionError, LocalVideoTrack, Track } from 'livekit-client';

import { Avatar, RoleBadge } from '../components/ui';
import { colors } from '../theme';
import { CallState, useCalls } from './CallContext';
import { InCallChatPanel, useInCallChat } from './InCallChat';

export function CallOverlay() {
  const { state } = useCalls();
  if (state.phase === 'idle') return null;
  return (
    <View style={StyleSheet.absoluteFill}>
      {state.phase === 'incoming' && <IncomingView state={state} />}
      {state.phase === 'outgoing' && <OutgoingView state={state} />}
      {state.phase === 'active' && <ActiveView state={state} />}
      {state.phase === 'ended' && <EndedView state={state} />}
    </View>
  );
}

function CallerHeader({ state, subtitle }: { state: Exclude<CallState, { phase: 'idle' }>; subtitle: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.encrypted}>
        <Ionicons name="lock-closed" size={12} color="#8696A0" />
        <Text style={styles.encryptedText}>Private call · no phone numbers shared</Text>
      </View>
      <Avatar name={state.peer.name} url={state.peer.avatar_url} size={110} />
      <Text style={styles.peerName}>{state.peer.name}</Text>
      <RoleBadge role={state.peer.role} />
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

function RoundButton({ icon, color, onPress, label, size = 64 }: { icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void; label?: string; size?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.round, { width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: pressed ? 0.75 : 1 }]}>
        <Ionicons name={icon} size={size * 0.42} color="white" />
      </Pressable>
      {label ? <Text style={styles.roundLabel}>{label}</Text> : null}
    </View>
  );
}

function IncomingView({ state }: { state: Extract<CallState, { phase: 'incoming' }> }) {
  const { accept, reject } = useCalls();
  return (
    <SafeAreaView style={styles.screen}>
      <CallerHeader state={state} subtitle={`Incoming ${state.kind === 'VIDEO' ? 'video' : 'voice'} call`} />
      <View style={styles.actions}>
        <RoundButton icon="close" color={colors.danger} onPress={reject} label="Decline" />
        <RoundButton icon={state.kind === 'VIDEO' ? 'videocam' : 'call'} color={colors.success} onPress={accept} label="Accept" />
      </View>
    </SafeAreaView>
  );
}

function OutgoingView({ state }: { state: Extract<CallState, { phase: 'outgoing' }> }) {
  const { hangup } = useCalls();
  return (
    <SafeAreaView style={styles.screen}>
      <CallerHeader state={state} subtitle={state.callId ? 'Ringing…' : 'Calling…'} />
      <View style={styles.actions}>
        <RoundButton icon="call" color={colors.danger} onPress={hangup} label="End" />
      </View>
    </SafeAreaView>
  );
}

function EndedView({ state }: { state: Extract<CallState, { phase: 'ended' }> }) {
  return (
    <SafeAreaView style={styles.screen}>
      <CallerHeader state={state} subtitle={state.message} />
    </SafeAreaView>
  );
}

// Constant outside the component: LiveKitRoom compares options by value anyway,
// but a stable object makes the intent obvious.
const ROOM_OPTIONS = { adaptiveStream: { pixelDensity: 'screen' as const } };

function ActiveView({ state }: { state: Extract<CallState, { phase: 'active' }> }) {
  const { hangup } = useCalls();
  useKeepAwake(); // don't let the screen sleep during a call

  // IMPORTANT: LiveKitRoom re-runs its connect effect whenever `onError`
  // changes identity. An inline arrow function (new every render) made it
  // abort the half-finished connection on the first re-render, causing
  // "The remote description was null". Keep the callback stable via a ref.
  const hangupRef = useRef(hangup);
  hangupRef.current = hangup;
  const onError = useCallback((error: Error) => {
    if (error instanceof ConnectionError) {
      hangupRef.current(); // couldn't reach the media server: end the call cleanly
    } else {
      // Camera/mic publish problems shouldn't drop the whole call.
      console.warn('Call media warning:', error.message);
    }
  }, []);

  // The audio session routes call audio correctly (echo cancellation, earpiece/speaker).
  useEffect(() => {
    AudioSession.startAudioSession();
    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  return (
    <LiveKitRoom
      serverUrl={state.livekitUrl}
      token={state.token}
      connect
      audio
      video={state.kind === 'VIDEO'}
      options={ROOM_OPTIONS}
      onError={onError}
    >
      <ActiveCallUI state={state} />
    </LiveKitRoom>
  );
}

function useTimer(startedAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function ActiveCallUI({ state }: { state: Extract<CallState, { phase: 'active' }> }) {
  const { hangup } = useCalls();
  const connection = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  // Camera AND screen-share tracks: if the other person shares their screen
  // (e.g. a site plan or documents), the viewer must see it, not just the sharer.
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
  const timer = useTimer(state.startedAt);
  const [speaker, setSpeaker] = useState(state.kind === 'VIDEO');
  const [frontCamera, setFrontCamera] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const chat = useInCallChat(chatOpen);

  const isLive = (t: (typeof tracks)[number] | undefined) => !!t && isTrackReference(t) && !t.publication.isMuted;
  const remoteScreen = tracks.find((t) => !t.participant.isLocal && t.source === Track.Source.ScreenShare && isLive(t));
  const remoteCamera = tracks.find((t) => !t.participant.isLocal && t.source === Track.Source.Camera);
  const remote = remoteScreen ?? remoteCamera; // a shared screen takes the main view
  const local = tracks.find((t) => t.participant.isLocal && t.source === Track.Source.Camera);
  const sharing = !!remoteScreen;
  // Screen shares show even in voice calls, since they're explicitly shared content.
  const isVideo = state.kind === 'VIDEO' || sharing;
  const remoteVideo = isLive(remote);

  // Video calls default to loudspeaker, voice calls to the earpiece (like WhatsApp).
  useEffect(() => {
    AudioSession.selectAudioOutput(speaker ? 'speaker' : 'earpiece').catch(() => {});
  }, [speaker]);

  const flipCamera = async () => {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (track instanceof LocalVideoTrack) {
      const next = !frontCamera;
      await track.restartTrack({ facingMode: next ? 'user' : 'environment' });
      setFrontCamera(next);
    }
  };

  // "Accepted" (signalling) isn't the same as "joined" (media): show the timer
  // only once the other person is actually in the LiveKit room.
  const peerJoined = useRemoteParticipants().length > 0;
  const firstName = state.peer.name.split(' ')[0];
  const status =
    connection !== 'connected'
      ? 'Connecting…'
      : !peerJoined
        ? `Waiting for ${firstName} to join…`
        : isVideo && !remoteVideo
          ? `${timer} · ${firstName}'s camera is off`
          : timer;

  return (
    <View style={styles.activeScreen}>
      {isVideo && remoteVideo && remote && isTrackReference(remote) ? (
        // 'contain' for screens so documents aren't cropped; 'cover' for faces.
        <VideoTrack trackRef={remote} style={StyleSheet.absoluteFill} objectFit={sharing ? 'contain' : 'cover'} />
      ) : (
        <SafeAreaView style={styles.screen}>
          <CallerHeader state={state} subtitle={status} />
        </SafeAreaView>
      )}

      {isVideo && remoteVideo && (
        <SafeAreaView style={styles.videoTopBar} edges={['top']}>
          <Text style={styles.videoName}>{state.peer.name}</Text>
          <Text style={styles.videoTimer}>{sharing ? `${timer} · sharing their screen` : status}</Text>
        </SafeAreaView>
      )}

      {isVideo && local && isTrackReference(local) && isCameraEnabled && (
        <VideoTrack trackRef={local} style={styles.selfView} objectFit="cover" mirror={frontCamera} />
      )}

      <SafeAreaView style={styles.controlsBar} edges={['bottom']}>
        <View style={styles.controls}>
          <RoundButton size={50} icon={speaker ? 'volume-high' : 'volume-low'} color={speaker ? colors.secondary : OFF} onPress={() => setSpeaker((s) => !s)} />
          {state.kind === 'VIDEO' && (
            <RoundButton size={50} icon={isCameraEnabled ? 'videocam' : 'videocam-off'} color={isCameraEnabled ? OFF : colors.secondary} onPress={() => localParticipant.setCameraEnabled(!isCameraEnabled)} />
          )}
          {state.kind === 'VIDEO' && <RoundButton size={50} icon="camera-reverse" color={OFF} onPress={flipCamera} />}
          <RoundButton size={50} icon={isMicrophoneEnabled ? 'mic' : 'mic-off'} color={isMicrophoneEnabled ? OFF : colors.secondary} onPress={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)} />
          <View>
            <RoundButton size={50} icon="chatbubble-ellipses" color={chatOpen ? colors.secondary : OFF} onPress={() => setChatOpen((o) => !o)} />
            {chat.unread > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{chat.unread > 9 ? '9+' : chat.unread}</Text>
              </View>
            )}
          </View>
          <RoundButton size={50} icon="call" color={colors.danger} onPress={hangup} />
        </View>
      </SafeAreaView>

      {chatOpen && <InCallChatPanel chat={chat} onClose={() => setChatOpen(false)} />}
    </View>
  );
}

const OFF = 'rgba(255,255,255,0.18)';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.callBackground, justifyContent: 'space-between' },
  activeScreen: { flex: 1, backgroundColor: colors.callBackground },
  header: { alignItems: 'center', paddingTop: 48, gap: 10 },
  encrypted: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 28 },
  encryptedText: { color: '#8696A0', fontSize: 12 },
  peerName: { color: 'white', fontSize: 28, fontWeight: '600', marginTop: 8 },
  subtitle: { color: '#D1D7DB', fontSize: 16, marginTop: 6 },
  actions: { flexDirection: 'row', justifyContent: 'space-evenly', paddingBottom: 64 },
  round: { alignItems: 'center', justifyContent: 'center' },
  roundLabel: { color: 'white', fontSize: 14 },
  videoTopBar: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.25)' },
  videoName: { color: 'white', fontSize: 20, fontWeight: '600', marginTop: 8 },
  videoTimer: { color: '#D1D7DB', fontSize: 14, marginBottom: 10 },
  selfView: { position: 'absolute', top: 110, right: 16, width: 110, height: 165, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  controlsBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(17,27,33,0.85)', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', paddingVertical: 18 },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: 'white', fontSize: 11, fontWeight: '700' },
});
