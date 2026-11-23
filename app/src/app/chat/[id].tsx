/**
 * One conversation: WhatsApp-style bubbles, day separators, read ticks,
 * typing indicator, call history entries, and voice/video call buttons.
 *
 * Sending is optimistic: the bubble appears instantly with a clock icon, is
 * replaced by the server's copy when confirmed, and shows "tap to retry" if
 * it fails. New messages arrive over the socket (message:new).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, uploadFile } from '../../api/client';
import type { ChatMessage, Conversation } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useCalls } from '../../calls/CallContext';
import { dayLabel, describeCall, timeLabel } from '../../chat/format';
import { useUnread } from '../../chat/UnreadContext';
import { FileBubbleContent, parseAttachment, VideoBubbleContent, VideoPlayerModal } from '../../chat/Attachments';
import { FullScreenViewer } from '../../components/PhotoGallery';
import { Avatar } from '../../components/ui';
import { formatPrice } from '../../lib/format';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSocket } from '../../realtime/SocketContext';
import { colors, fonts } from '../../theme';

const TYPING_SEND_INTERVAL = 3000; // throttle: at most one "typing" event per 3 s
const TYPING_SHOW_FOR = 4000; // hide "typing…" if nothing new arrives for 4 s
const MAX_VIDEO = 40 * 1024 * 1024; // matches the server limits
const MAX_DOC = 10 * 1024 * 1024;
const DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];
type PendingFile = { uri: string; name: string; type: string; size?: number };

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { startCall } = useCalls();
  const { refresh: refreshUnread } = useUnread();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardState((s) => s.isVisible);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]); // oldest → newest
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const pendingFiles = useRef<Record<string, PendingFile>>({}); // for retrying failed uploads
  const [playing, setPlaying] = useState<string | null>(null); // full-screen video
  const [viewing, setViewing] = useState<string | null>(null); // full-screen picture
  const myId = user?.id ?? '';

  const markRead = useCallback(() => {
    api(`/conversations/${id}/read`, { method: 'POST' })
      .then(refreshUnread)
      .catch(() => {});
  }, [id, refreshUnread]);

  useEffect(() => {
    (async () => {
      try {
        const [c, m] = await Promise.all([api<Conversation>(`/conversations/${id}`), api<ChatMessage[]>(`/conversations/${id}/messages`)]);
        setConv(c);
        setMessages(m);
        markRead();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, markRead]);

  // Live updates for this conversation.
  useEffect(() => {
    if (!socket) return;
    const onMessage = (m: ChatMessage) => {
      if (m.conversation_id !== id) return;
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      if (m.sender_id !== myId) {
        setPeerTyping(false);
        markRead(); // I'm looking at it, so it's read
      }
    };
    const onRead = (d: { conversation_id: string; at: string }) => {
      if (d.conversation_id === id) setConv((c) => (c ? { ...c, peer_last_read_at: d.at } : c));
    };
    const onTyping = (d: { conversation_id: string }) => {
      if (d.conversation_id !== id) return;
      setPeerTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setPeerTyping(false), TYPING_SHOW_FOR);
    };
    socket.on('message:new', onMessage);
    socket.on('conversation:read', onRead);
    socket.on('typing', onTyping);
    return () => {
      socket.off('message:new', onMessage);
      socket.off('conversation:read', onRead);
      socket.off('typing', onTyping);
    };
  }, [socket, id, myId, markRead]);

  const onChangeText = (t: string) => {
    setText(t);
    const now = Date.now();
    if (t && socket?.connected && now - lastTypingSent.current > TYPING_SEND_INTERVAL) {
      lastTypingSent.current = now;
      socket.emit('typing', { conversation_id: id });
    }
  };

  const send = async (body: string, retryId?: string) => {
    const tempId = retryId ?? `temp-${Date.now()}`;
    const optimistic: ChatMessage = { id: tempId, conversation_id: id, sender_id: myId, type: 'TEXT', body, created_at: new Date().toISOString(), pending: 'sending' };
    setMessages((list) => (retryId ? list.map((m) => (m.id === retryId ? optimistic : m)) : [...list, optimistic]));
    try {
      const saved = await api<ChatMessage>(`/conversations/${id}/messages`, { method: 'POST', body: { body } });
      // The socket echo may already have added it: drop the temp bubble and keep one copy.
      setMessages((list) => {
        const withoutTemp = list.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === saved.id) ? withoutTemp : [...withoutTemp, saved];
      });
    } catch {
      setMessages((list) => list.map((m) => (m.id === tempId ? { ...m, pending: 'failed' } : m)));
    }
  };

  /**
   * Photos, videos and documents: shown instantly (photos from the local file,
   * videos/documents as an "uploading" card), uploaded via XHR (see uploadFile),
   * then swapped for the server's copy.
   */
  const sendFile = async (file: PendingFile, retryId?: string) => {
    const kind: ChatMessage['type'] = file.type.startsWith('image/') ? 'IMAGE' : file.type.startsWith('video/') ? 'VIDEO' : 'FILE';
    if (kind !== 'IMAGE' && file.size && file.size > (kind === 'VIDEO' ? MAX_VIDEO : MAX_DOC)) {
      Alert.alert('File too large', kind === 'VIDEO' ? 'Videos can be up to 40 MB (about a minute).' : 'Documents can be up to 10 MB.');
      return;
    }
    const tempId = retryId ?? `temp-file-${Date.now()}`;
    pendingFiles.current[tempId] = file;
    const body = kind === 'IMAGE' ? file.uri : JSON.stringify({ url: file.uri, name: file.name, size: file.size ?? 0, mime: file.type });
    const optimistic: ChatMessage = { id: tempId, conversation_id: id, sender_id: myId, type: kind, body, created_at: new Date().toISOString(), pending: 'sending' };
    setMessages((list) => (retryId ? list.map((m) => (m.id === retryId ? optimistic : m)) : [...list, optimistic]));
    try {
      const saved = await uploadFile<ChatMessage>(`/conversations/${id}/${kind === 'IMAGE' ? 'images' : 'attachments'}`, file);
      delete pendingFiles.current[tempId];
      setMessages((list) => {
        const withoutTemp = list.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === saved.id) ? withoutTemp : [...withoutTemp, saved];
      });
    } catch (e: any) {
      console.warn('[chat] attachment upload failed', e?.message);
      setMessages((list) => list.map((m) => (m.id === tempId ? { ...m, pending: 'failed' } : m)));
    }
  };

  const pickAttachment = () =>
    Alert.alert('Send', undefined, [
      { text: 'Camera', onPress: () => chooseMedia('camera') },
      { text: 'Photo or video', onPress: () => chooseMedia('library') },
      { text: 'Document', onPress: chooseDocument },
    ]);

  const chooseMedia = async (source: 'camera' | 'library') => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: source === 'camera' ? ['images'] : ['images', 'videos'], quality: 0.7, videoMaxDuration: 60 };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Camera permission', 'Allow camera access to take photos.');
    }
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    const isVideo = a.type === 'video';
    sendFile({
      uri: a.uri,
      name: a.fileName ?? `chat-${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`,
      type: a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
      size: a.fileSize,
    });
  };

  const chooseDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: DOC_TYPES, copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const d = result.assets[0];
    sendFile({ uri: d.uri, name: d.name, type: d.mimeType ?? 'application/octet-stream', size: d.size });
  };

  const retry = (m: ChatMessage) => {
    if (m.type !== 'TEXT' && pendingFiles.current[m.id]) sendFile(pendingFiles.current[m.id], m.id);
    else send(m.body, m.id);
  };

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    send(body);
  };

  // FlatList is inverted (newest at the bottom, like every chat app), so feed it newest-first.
  const data = useMemo(() => [...messages].reverse(), [messages]);
  const peerReadAt = conv?.peer_last_read_at ? new Date(conv.peer_last_read_at).getTime() : 0;

  const header = conv && (
    <Stack.Screen
      options={{
        headerTitle: () => (
          <View style={styles.headerTitle}>
            <Avatar name={conv.peer.name} url={conv.peer.avatar_url} size={36} />
            <View>
              <Text style={styles.headerName} numberOfLines={1}>
                {conv.peer.name}
              </Text>
              <Text style={styles.headerStatus}>{peerTyping ? 'typing…' : conv.peer_online ? 'online' : conv.peer.role.toLowerCase()}</Text>
            </View>
          </View>
        ),
        headerRight: () => (
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <Pressable hitSlop={10} onPress={() => startCall(conv.peer, 'VIDEO')}>
              <Ionicons name="videocam" size={24} color="white" />
            </Pressable>
            <Pressable hitSlop={10} onPress={() => startCall(conv.peer, 'AUDIO')}>
              <Ionicons name="call" size={21} color="white" />
            </Pressable>
          </View>
        ),
      }}
    />
  );

  if (loading || !conv) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Chat' }} />
        {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.primary} size="large" />}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.sand }}>
      {header}
      {conv.listing && (
        <Pressable style={styles.listingBar} onPress={() => router.push({ pathname: '/listing/[id]', params: { id: conv.listing!.id } })}>
          {conv.listing.image_url ? (
            <Image source={{ uri: conv.listing.image_url }} style={styles.listingThumb} contentFit="cover" />
          ) : (
            <View style={[styles.listingThumb, styles.listingThumbEmpty]}>
              <Ionicons name="leaf-outline" size={18} color={colors.secondary} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.listingTitle} numberOfLines={1}>
              {conv.listing.title}
            </Text>
            <Text style={styles.muted}>
              {formatPrice(conv.listing.price_inr)}
              {conv.listing.city ? ` · ${conv.listing.city}` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      )}

      <FlatList
        data={data}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 4 }}
        // Inverted list: the "header" renders at the bottom, right above the input.
        ListHeaderComponent={peerTyping ? <TypingBubble /> : undefined}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>🔒 Messages stay inside LandConnect. Neither side sees the other's phone number or email.</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          // In the inverted list, data[index + 1] is the *older* neighbour.
          const older = data[index + 1];
          const showDay = !older || new Date(older.created_at).toDateString() !== new Date(item.created_at).toDateString();
          return (
            <View>
              {showDay && (
                <View style={styles.dayPill}>
                  <Text style={styles.dayText}>{dayLabel(item.created_at)}</Text>
                </View>
              )}
              <MessageRow msg={item} myId={myId} readByPeer={new Date(item.created_at).getTime() <= peerReadAt} onRetry={() => retry(item)} onOpenImage={setViewing} onPlayVideo={setPlaying} />
            </View>
          );
        }}
      />

      {/* Keyboard open: KeyboardAvoidingView lifts us above it. Closed: clear Android's nav bar. */}
      <View style={[styles.inputBar, { paddingBottom: keyboardOpen ? 8 : 8 + insets.bottom }]}>
        <Pressable style={styles.attach} onPress={pickAttachment} hitSlop={6}>
          <Ionicons name="attach" size={24} color={colors.textMuted} style={{ transform: [{ rotate: '45deg' }] }} />
        </Pressable>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onChangeText}
          placeholder="Message"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={4000}
        />
        <Pressable style={[styles.send, !text.trim() && { opacity: 0.5 }]} onPress={submit} disabled={!text.trim()}>
          <Ionicons name="send" size={20} color="white" />
        </Pressable>
      </View>
      {playing && <VideoPlayerModal url={playing} onClose={() => setPlaying(null)} />}
      {viewing && <FullScreenViewer images={[{ id: viewing, url: viewing, position: 0 }]} start={0} onClose={() => setViewing(null)} />}
    </KeyboardAvoidingView>
  );
}

/** Three dots bouncing in a wave, like WhatsApp's "typing" bubble (native-driven, so it stays smooth). */
function TypingBubble() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const bounce = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]);
    const loop = Animated.loop(Animated.sequence([Animated.stagger(140, dots.map(bounce)), Animated.delay(250)]));
    loop.start();
    return () => loop.stop();
  }, [dots]);
  return (
    <View style={[styles.bubble, styles.theirs, styles.typingBubble]}>
      {dots.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.typingDot,
            {
              opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

function MessageRow({ msg, myId, readByPeer, onRetry, onOpenImage, onPlayVideo }: { msg: ChatMessage; myId: string; readByPeer: boolean; onRetry: () => void; onOpenImage: (url: string) => void; onPlayVideo: (url: string) => void }) {
  if (msg.type === 'SYSTEM') {
    return (
      <View style={styles.systemPill}>
        <Text style={styles.systemText}>{msg.body}</Text>
      </View>
    );
  }
  if (msg.type === 'CALL_LOG') {
    const call = describeCall(msg, myId);
    return (
      <View style={styles.systemPill}>
        <Ionicons name={call.video ? 'videocam' : 'call'} size={14} color={call.missed ? colors.danger : colors.secondary} />
        <Text style={[styles.systemText, call.missed && { color: colors.danger }]}>
          {call.text} · {timeLabel(msg.created_at)}
        </Text>
      </View>
    );
  }
  const mine = msg.sender_id === myId;
  const isImage = msg.type === 'IMAGE';
  const att = msg.type === 'VIDEO' || msg.type === 'FILE' ? parseAttachment(msg.body) : null;
  const uploading = msg.pending === 'sending';
  return (
    <Pressable
      // Videos and documents handle their own taps; images open the viewer; failed sends retry.
      disabled={!isImage && msg.pending !== 'failed'}
      onPress={msg.pending === 'failed' ? onRetry : isImage ? () => onOpenImage(msg.body) : undefined}
      style={[styles.bubble, mine ? styles.mine : styles.theirs, (isImage || msg.type === 'VIDEO') && styles.imageBubble]}
    >
      {isImage ? (
        <Image source={{ uri: msg.body }} style={[styles.chatImage, uploading && { opacity: 0.6 }]} contentFit="cover" transition={150} />
      ) : msg.type === 'VIDEO' ? (
        <VideoBubbleContent att={att} uploading={uploading || msg.pending === 'failed'} onPress={() => att && onPlayVideo(att.url)} />
      ) : msg.type === 'FILE' ? (
        <FileBubbleContent att={att} uploading={uploading || msg.pending === 'failed'} />
      ) : (
        <Text style={styles.body}>{msg.body}</Text>
      )}
      <View style={styles.metaRow}>
        <Text style={styles.time}>{timeLabel(msg.created_at)}</Text>
        {mine &&
          (msg.pending === 'sending' ? (
            <Ionicons name="time-outline" size={13} color={colors.textMuted} />
          ) : msg.pending === 'failed' ? (
            <Ionicons name="alert-circle" size={14} color={colors.danger} />
          ) : (
            <Ionicons name="checkmark-done" size={15} color={readByPeer ? '#2B9FD9' : colors.textMuted} />
          ))}
      </View>
      {msg.pending === 'failed' && <Text style={styles.failed}>Not sent · tap to retry</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: 13, color: colors.textMuted },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: -12 },
  headerName: { color: 'white', fontSize: 16, fontFamily: fonts.heading, maxWidth: 170 },
  headerStatus: { color: colors.paleMint, fontSize: 12 },
  listingBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  listingThumb: { width: 42, height: 42, borderRadius: 8 },
  listingThumbEmpty: { backgroundColor: colors.sand, alignItems: 'center', justifyContent: 'center' },
  listingTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  emptyWrap: { transform: [{ scaleY: -1 }], padding: 24 }, // undo the inverted list's flip
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: 13, lineHeight: 19, backgroundColor: '#FFF6E5', padding: 12, borderRadius: 10 },
  dayPill: { alignSelf: 'center', backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, marginVertical: 8 },
  dayText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  systemPill: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF6E5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, marginVertical: 4, maxWidth: '85%' },
  systemText: { fontSize: 13, color: colors.text },
  bubble: { maxWidth: '80%', paddingHorizontal: 12, paddingTop: 7, paddingBottom: 5, borderRadius: 14, marginVertical: 1 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.bubbleMine, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.white, borderBottomLeftRadius: 4 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 2 },
  time: { fontSize: 11, color: colors.textMuted },
  failed: { fontSize: 11, color: colors.danger, marginTop: 2 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8, backgroundColor: colors.sand },
  input: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: colors.white, color: colors.text, fontSize: 15 },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  attach: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
  imageBubble: { padding: 4, paddingBottom: 4 },
  chatImage: { width: 220, height: 220, borderRadius: 10 },
  typingBubble: { flexDirection: 'row', gap: 5, paddingVertical: 14, paddingHorizontal: 16 },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },
});
