/** Chats tab: WhatsApp-style list of conversations, newest first, with unread badges. */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '../../api/client';
import type { Conversation } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { listTimeLabel, previewText } from '../../chat/format';
import { Avatar, Button, EmptyState, RoleBadge } from '../../components/ui';
import { useSocket } from '../../realtime/SocketContext';
import { colors } from '../../theme';

export default function ChatsScreen() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<Conversation[]>('/conversations'));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // New messages anywhere move that chat to the top with its new preview.
  useEffect(() => {
    if (!socket) return;
    socket.on('message:new', load);
    return () => {
      socket.off('message:new', load);
    };
  }, [socket, load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[colors.primary]} />}
        contentContainerStyle={items.length ? undefined : { flex: 1 }}
        ListEmptyComponent={
          loading ? undefined : (
            <EmptyState
              icon={<Ionicons name="chatbubbles-outline" size={64} color={colors.secondary} />}
              title={error ?? 'No chats yet'}
              subtitle={error ? 'Pull down to retry.' : 'Message a seller from any listing, or find people below. Your number is never shared.'}
            >
              {!error && <Button title="Find people" onPress={() => router.push('/new-call')} style={{ marginTop: 16 }} />}
            </EmptyState>
          )
        }
        renderItem={({ item }) => {
          const unread = item.unread > 0;
          return (
            <Pressable style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.sand }]} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}>
              <View>
                <Avatar name={item.peer.name} url={item.peer.avatar_url} size={52} />
                {item.peer_online && <View style={styles.online} />}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.topLine}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.peer.name}
                  </Text>
                  <Text style={[styles.time, unread && { color: colors.primary, fontWeight: '600' }]}>{listTimeLabel(item.updated_at)}</Text>
                </View>
                <View style={styles.topLine}>
                  <Text style={[styles.preview, unread && { color: colors.text, fontWeight: '500' }]} numberOfLines={1}>
                    {previewText(item.last_message, user?.id ?? '')}
                  </Text>
                  {unread && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.metaLine}>
                  <RoleBadge role={item.peer.role} />
                  {item.listing && (
                    <Text style={styles.listing} numberOfLines={1}>
                      🏡 {item.listing.title}
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
      <Pressable style={styles.fab} onPress={() => router.push('/new-call')}>
        <Ionicons name="chatbubble-ellipses" size={24} color="white" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  online: { position: 'absolute', right: 1, bottom: 1, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.success, borderWidth: 2, borderColor: 'white' },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  time: { fontSize: 12, color: colors.textMuted },
  preview: { flex: 1, fontSize: 14, color: colors.textMuted },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listing: { flex: 1, fontSize: 12, color: colors.secondary },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 82 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 5 },
});
