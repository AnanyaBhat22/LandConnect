/** Meetings I host or was invited to. Open ones first, each with a Join button. */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Meeting } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Avatar, Button, EmptyState } from '../../components/ui';
import { useSocket } from '../../realtime/SocketContext';
import { colors } from '../../theme';

export default function MeetingsScreen() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canHost = user?.role === 'SELLER' || user?.role === 'BROKER';

  const load = useCallback(async () => {
    try {
      setItems(await api<Meeting[]>('/meetings'));
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

  // New invitations and ended meetings update the list live.
  useEffect(() => {
    if (!socket) return;
    socket.on('meeting:invited', load);
    socket.on('meeting:ended', load);
    return () => {
      socket.off('meeting:invited', load);
      socket.off('meeting:ended', load);
    };
  }, [socket, load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.sand }}>
      <Stack.Screen options={{ title: 'Meetings' }} />
      <FlatList
        data={items}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[colors.primary]} />}
        contentContainerStyle={items.length ? { padding: 14, gap: 12, paddingBottom: 100 + insets.bottom } : { flex: 1 }}
        ListEmptyComponent={
          loading ? undefined : (
            <EmptyState
              icon={<Ionicons name="people-circle-outline" size={64} color={colors.secondary} />}
              title={error ?? 'No meetings yet'}
              subtitle={canHost ? 'Start a group video meeting with buyers, sellers or brokers.' : 'When a seller or broker invites you, the meeting shows up here.'}
            >
              {canHost && !error && <Button title="New meeting" onPress={() => router.push('/meetings/new')} style={{ marginTop: 16 }} />}
            </EmptyState>
          )
        }
        renderItem={({ item }) => {
          const people = [item.host, ...item.invitees];
          return (
            <View style={[styles.card, !item.is_open && { opacity: 0.6 }]}>
              <View style={styles.top}>
                <View style={styles.icon}>
                  <Ionicons name="people" size={22} color="white" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {item.is_host ? 'You are hosting' : `Hosted by ${item.host.name}`}
                    {item.listing_title ? ` · ${item.listing_title}` : ''}
                  </Text>
                </View>
                {item.is_open ? (
                  <Button title="Join" onPress={() => router.push({ pathname: '/meeting/[id]', params: { id: item.id } })} style={styles.join} />
                ) : (
                  <Text style={styles.ended}>Ended</Text>
                )}
              </View>
              <View style={styles.people}>
                {people.slice(0, 6).map((p) => (
                  <View key={p.id} style={styles.personAvatar}>
                    <Avatar name={p.name} url={p.avatar_url} size={28} />
                  </View>
                ))}
                <Text style={styles.muted}>
                  {people.length} participant{people.length === 1 ? '' : 's'}
                </Text>
              </View>
            </View>
          );
        }}
      />
      {canHost && (
        <Pressable style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={() => router.push('/meetings/new')}>
          <Ionicons name="add" size={30} color="white" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  join: { height: 40, paddingHorizontal: 18 },
  ended: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  people: { flexDirection: 'row', alignItems: 'center' },
  personAvatar: { marginRight: -6, borderWidth: 2, borderColor: 'white', borderRadius: 16 },
  fab: { position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 5 },
});
