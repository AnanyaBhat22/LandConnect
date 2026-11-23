/**
 * A meeting room: multi-party LiveKit call with a grid of participants.
 *
 * The server only gives a token to the host and invitees (POST /meetings/{id}/join).
 * Same building blocks as 1:1 calls: LiveKitRoom, audio session, in-call chat.
 * A shared screen takes the main area; everyone else shows as tiles below.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  useLocalParticipant,
  useParticipants,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';
import { ConnectionError, LocalVideoTrack, Track } from 'livekit-client';

import { api } from '../../api/client';
import type { Meeting, MeetingJoin } from '../../api/types';
import { ensureCallPermissions, useCalls } from '../../calls/CallContext';
import { InCallChatPanel, useInCallChat } from '../../calls/InCallChat';
import { Avatar } from '../../components/ui';
import { useSocket } from '../../realtime/SocketContext';
import { colors, fonts } from '../../theme';

const ROOM_OPTIONS = { adaptiveStream: { pixelDensity: 'screen' as const } };
const WIDTH = Dimensions.get('window').width;

export default function MeetingRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { socket } = useSocket();
  const { state: callState } = useCalls();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [join, setJoin] = useState<MeetingJoin | null>(null);
  const [error, setError] = useState<string | null>(null);
  useKeepAwake();

  useEffect(() => {
    (async () => {
      if (callState.phase !== 'idle' && callState.phase !== 'ended') {
        setError('Finish your current call before joining a meeting.');
        return;
      }
      if (!(await ensureCallPermissions('VIDEO'))) {
        setError('Allow camera and microphone access to join meetings.');
        return;
      }
      try {
        const list = await api<Meeting[]>('/meetings');
        setMeeting(list.find((m) => m.id === id) ?? null);
        setJoin(await api<MeetingJoin>(`/meetings/${id}/join`, { method: 'POST' }));
      } catch (e: any) {
        setError(e.message);
      }
    })();
    // Only on entry: joining shouldn't re-run when a later call state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Host ended the meeting: everyone leaves.
  useEffect(() => {
    if (!socket) return;
    const onEnded = (d: { meeting_id: string }) => {
      if (d.meeting_id !== id) return;
      Alert.alert('Meeting ended', 'The host ended this meeting.');
      router.back();
    };
    socket.on('meeting:ended', onEnded);
    return () => {
      socket.off('meeting:ended', onEnded);
    };
  }, [socket, id]);

  useEffect(() => {
    AudioSession.startAudioSession();
    AudioSession.selectAudioOutput('speaker').catch(() => {}); // group calls default to loudspeaker
    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  const leave = useCallback(() => router.back(), []);
  const leaveRef = useRef(leave);
  const onError = useCallback((e: Error) => {
    // Stable callback (see CallOverlay): an inline one would make LiveKitRoom reconnect on every render.
    if (e instanceof ConnectionError) leaveRef.current();
    else console.warn('Meeting media warning:', e.message);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.callBackground }}>
      <Stack.Screen options={{ headerShown: false }} />
      {error ? (
        <SafeAreaView style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.paleMint} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={leave} style={styles.backBtn}>
            <Text style={styles.backText}>Go back</Text>
          </Pressable>
        </SafeAreaView>
      ) : !join ? (
        <View style={styles.center}>
          <ActivityIndicator color="white" size="large" />
          <Text style={styles.errorText}>Joining meeting…</Text>
        </View>
      ) : (
        <LiveKitRoom serverUrl={join.livekit_url} token={join.token} connect audio video options={ROOM_OPTIONS} onError={onError}>
          <RoomUI meeting={meeting} onLeave={leave} />
        </LiveKitRoom>
      )}
    </View>
  );
}

function Tile({ trackRef, size }: { trackRef: TrackReferenceOrPlaceholder; size: { w: number; h: number } }) {
  const p = trackRef.participant;
  const live = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  return (
    <View style={[styles.tile, { width: size.w, height: size.h }]}>
      {live ? (
        <VideoTrack trackRef={trackRef} style={StyleSheet.absoluteFill} objectFit="cover" mirror={p.isLocal} />
      ) : (
        <View style={styles.tileAvatar}>
          <Avatar name={p.name || 'Guest'} size={Math.min(72, size.w * 0.4)} />
        </View>
      )}
      <View style={styles.nameTag}>
        {!p.isMicrophoneEnabled && <Ionicons name="mic-off" size={12} color="white" />}
        <Text style={styles.nameText} numberOfLines={1}>
          {p.isLocal ? 'You' : p.name || 'Guest'}
        </Text>
      </View>
      {p.isSpeaking && <View style={styles.speaking} pointerEvents="none" />}
    </View>
  );
}

function RoomUI({ meeting, onLeave }: { meeting: Meeting | null; onLeave: () => void }) {
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  // One tile per participant: their camera, or a placeholder with their initials.
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screens = useTracks([Track.Source.ScreenShare]).filter((t) => isTrackReference(t) && !t.participant.isLocal);
  const [chatOpen, setChatOpen] = useState(false);
  const chat = useInCallChat(chatOpen);
  const [front, setFront] = useState(true);

  const flip = async () => {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (track instanceof LocalVideoTrack) {
      await track.restartTrack({ facingMode: front ? 'environment' : 'user' });
      setFront(!front);
    }
  };

  const endForAll = () =>
    Alert.alert('End meeting for everyone?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/meetings/${meeting?.id}/end`, { method: 'POST' });
          } catch {}
          onLeave();
        },
      },
    ]);

  // Grid: 1 → full, 2 → stacked halves, 3+ → two columns.
  const n = Math.max(1, cameras.length);
  const cols = n <= 2 ? 1 : 2;
  const gridHeight = Dimensions.get('window').height * (screens.length ? 0.32 : 0.72);
  const rows = Math.ceil(n / cols);
  const tile = { w: (WIDTH - 12 - (cols - 1) * 6) / cols, h: Math.max(140, gridHeight / rows - 6) };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {meeting?.title ?? 'Meeting'}
        </Text>
        <Text style={styles.subtitle}>
          {participants.length} in the meeting{meeting?.listing_title ? ` · ${meeting.listing_title}` : ''}
        </Text>
      </View>

      {screens[0] && isTrackReference(screens[0]) && (
        <View style={styles.screenShare}>
          <VideoTrack trackRef={screens[0]} style={StyleSheet.absoluteFill} objectFit="contain" />
          <Text style={styles.shareLabel}>{screens[0].participant.name} is sharing their screen</Text>
        </View>
      )}

      <FlatList
        data={cameras}
        key={cols} // re-layout when the column count changes
        numColumns={cols}
        keyExtractor={(t) => `${t.participant.identity}`}
        contentContainerStyle={{ padding: 6, gap: 6 }}
        columnWrapperStyle={cols > 1 ? { gap: 6 } : undefined}
        renderItem={({ item }) => <Tile trackRef={item} size={tile} />}
      />

      <View style={styles.controls}>
        <Ctl icon={isMicrophoneEnabled ? 'mic' : 'mic-off'} active={!isMicrophoneEnabled} onPress={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)} />
        <Ctl icon={isCameraEnabled ? 'videocam' : 'videocam-off'} active={!isCameraEnabled} onPress={() => localParticipant.setCameraEnabled(!isCameraEnabled)} />
        <Ctl icon="camera-reverse" onPress={flip} />
        <View>
          <Ctl icon="chatbubble-ellipses" active={chatOpen} onPress={() => setChatOpen((o) => !o)} />
          {chat.unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{chat.unread > 9 ? '9+' : chat.unread}</Text>
            </View>
          )}
        </View>
        <Ctl icon="exit-outline" danger onPress={onLeave} />
        {meeting?.is_host && <Ctl icon="stop-circle" danger onPress={endForAll} />}
      </View>

      {chatOpen && <InCallChatPanel chat={chat} onClose={() => setChatOpen(false)} />}
    </SafeAreaView>
  );
}

function Ctl({ icon, onPress, active, danger }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; active?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ctl, { backgroundColor: danger ? colors.danger : active ? colors.secondary : 'rgba(255,255,255,0.16)', opacity: pressed ? 0.75 : 1 }]}>
      <Ionicons name={icon} size={22} color="white" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  errorText: { color: 'white', fontSize: 16, textAlign: 'center' },
  backBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)' },
  backText: { color: 'white', fontWeight: '600' },
  header: { alignItems: 'center', paddingVertical: 10 },
  title: { color: 'white', fontSize: 18, fontFamily: fonts.heading, paddingHorizontal: 20 },
  subtitle: { color: colors.paleMint, fontSize: 13, marginTop: 2 },
  screenShare: { height: '32%', marginHorizontal: 6, borderRadius: 12, overflow: 'hidden', backgroundColor: 'black' },
  shareLabel: { position: 'absolute', bottom: 6, left: 8, color: 'white', fontSize: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  tile: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#1B2A24' },
  tileAvatar: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nameTag: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, maxWidth: '85%' },
  nameText: { color: 'white', fontSize: 12, fontWeight: '600' },
  speaking: { ...StyleSheet.absoluteFill, borderWidth: 3, borderColor: colors.mint, borderRadius: 14 },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', paddingVertical: 14, backgroundColor: 'rgba(17,27,33,0.9)' },
  ctl: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: 'white', fontSize: 11, fontWeight: '700' },
});
