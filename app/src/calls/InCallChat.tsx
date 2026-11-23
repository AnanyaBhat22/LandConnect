/**
 * Chat inside a call, over the LiveKit room's own data channel.
 *
 * Uses LiveKit's standard chat protocol (useChat), so messages interoperate
 * with any other LiveKit client in the room (e.g. the browser on the laptop).
 * Messages exist only for the duration of the call; persistent conversations
 * live in the Chats tab instead.
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '@livekit/react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';

/** Messages + unread count; lives in the call UI so nothing is lost while the panel is closed. */
export function useInCallChat(open: boolean) {
  const chat = useChat();
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (open) setSeen(chat.chatMessages.length);
  }, [open, chat.chatMessages.length]);
  return { ...chat, unread: open ? 0 : Math.max(0, chat.chatMessages.length - seen) };
}

type Chat = ReturnType<typeof useInCallChat>;

export function InCallChatPanel({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  const send = async () => {
    const msg = text.trim();
    if (!msg || chat.isSending) return;
    setText('');
    try {
      await chat.send(msg);
    } catch {
      setText(msg); // give the text back so the user can retry
    }
  };

  // Newest first: the input sits at the TOP of the panel, so the latest
  // messages are right under it.
  const newestFirst = [...chat.chatMessages].reverse();

  return (
    // Its own full-screen window (Modal), not a view on top of the call.
    // Why: on Android, live video (WebRTC SurfaceViews) is drawn on a separate
    // hardware layer that can paint OVER normal views, which hid the overlay
    // panel. A Modal is a separate window above the call screen, so video
    // can't cover it. The input sits at the top, so the keyboard can't either.
    // The call keeps running underneath; "Back to call" closes the window.
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.panel, { paddingTop: insets.top }]}>
        <Pressable style={styles.callBar} onPress={onClose}>
          <Ionicons name="call" size={14} color="white" />
          <Text style={styles.callBarText}>Call in progress · tap to go back</Text>
        </Pressable>
        <View style={styles.header}>
          <Text style={styles.title}>Chat in call</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={18} color={colors.primary} />
            <Text style={styles.backText}>Back to call</Text>
          </Pressable>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Message everyone in the call"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={send}
            submitBehavior="submit" // keep the keyboard open after sending, like a chat app
            returnKeyType="send"
            autoFocus
          />
          <Pressable style={[styles.send, !text.trim() && { opacity: 0.5 }]} onPress={send} disabled={!text.trim()} hitSlop={8}>
            <Ionicons name="send" size={18} color="white" />
          </Pressable>
        </View>
        <FlatList
          ref={listRef}
          data={newestFirst}
          keyExtractor={(m) => m.id ?? String(m.timestamp)}
          contentContainerStyle={{ padding: 12, gap: 8, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.empty}>Messages here are only visible during this call.</Text>}
          renderItem={({ item }) => {
            const mine = item.from?.isLocal;
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && <Text style={styles.sender}>{item.from?.name || 'Them'}</Text>}
                <Text style={styles.message}>{item.message}</Text>
                <Text style={styles.time}>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({

  callBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, backgroundColor: colors.success },
  callBarText: { color: 'white', fontSize: 13, fontWeight: '600' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  panel: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 24 },
  bubble: { maxWidth: '80%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.bubbleMine },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  sender: { fontSize: 12, fontWeight: '600', color: colors.secondary, marginBottom: 2 },
  message: { fontSize: 15, color: colors.text },
  time: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end', marginTop: 2 },
  inputRow: { flexDirection: 'row', gap: 8, padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  input: { flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 16, backgroundColor: colors.surface, color: colors.text, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
