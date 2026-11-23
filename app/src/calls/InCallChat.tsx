/**
 * Chat inside a call, over the LiveKit room's own data channel.
 *
 * Uses LiveKit's standard chat protocol (useChat), so messages interoperate
 * with any other LiveKit client in the room (e.g. the browser on the laptop).
 * Messages exist only for the duration of the call; persistent conversations
 * live in the Chats tab instead.
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '@livekit/react-native';

import { useKeyboardHeight } from '../lib/useKeyboardHeight';
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
  const keyboardHeight = useKeyboardHeight();

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

  return (
    // Lift the panel above the keyboard (edge-to-edge Android doesn't resize the window).
    <View style={[styles.wrap, { paddingBottom: keyboardHeight }]}>
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.title}>Chat in call</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <FlatList
          ref={listRef}
          data={chat.chatMessages}
          keyExtractor={(m) => m.id ?? String(m.timestamp)}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          contentContainerStyle={{ padding: 12, gap: 8, flexGrow: 1 }}
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
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable style={[styles.send, !text.trim() && { opacity: 0.5 }]} onPress={send} disabled={!text.trim()}>
            <Ionicons name="send" size={18} color="white" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // absoluteFillObject was removed in this React Native version; spell it out.
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  panel: { height: '60%', backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 24 },
  bubble: { maxWidth: '80%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.bubbleMine },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  sender: { fontSize: 12, fontWeight: '600', color: colors.secondary, marginBottom: 2 },
  message: { fontSize: 15, color: colors.text },
  time: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end', marginTop: 2 },
  inputRow: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 16, backgroundColor: colors.surface, color: colors.text, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
