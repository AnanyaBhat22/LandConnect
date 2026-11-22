import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '../../api/client';
import type { CallHistoryItem } from '../../api/types';
import { useCalls } from '../../calls/CallContext';
import { Avatar, EmptyState } from '../../components/ui';
import { colors } from '../../theme';

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

function duration(s: number | null): string {
  if (!s) return '';
  return s < 60 ? ` · ${s}s` : ` · ${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function CallsScreen() {
  const { startCall, historyVersion } = useCalls();
  const [items, setItems] = useState<CallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<CallHistoryItem[]>('/calls'));
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
  useEffect(() => {
    load();
  }, [historyVersion, load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[colors.primary]} />}
        contentContainerStyle={items.length === 0 ? { flex: 1 } : undefined}
        ListEmptyComponent={
          loading ? undefined : (
            <EmptyState
              icon={<Ionicons name="call-outline" size={64} color={colors.teal} />}
              title={error ?? 'No calls yet'}
              subtitle={error ? 'Pull down to retry.' : 'Tap the button below to call someone. Your number is never shared.'}
            />
          )
        }
        renderItem={({ item }) => {
          const missed = item.direction === 'incoming' && (item.status === 'MISSED' || item.status === 'REJECTED');
          const arrow = item.direction === 'outgoing' ? 'arrow-up' : 'arrow-down';
          return (
            <View style={styles.row}>
              <Avatar name={item.peer.name} url={item.peer.avatar_url} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, missed && { color: colors.danger }]}>{item.peer.name}</Text>
                <View style={styles.meta}>
                  <Ionicons name={arrow} size={14} color={missed ? colors.danger : colors.accent} style={{ transform: [{ rotate: '45deg' }] }} />
                  <Text style={styles.metaText}>
                    {when(item.created_at)}
                    {item.status === 'COMPLETED' ? duration(item.duration_seconds) : ` · ${item.status.toLowerCase()}`}
                  </Text>
                </View>
              </View>
              <Pressable hitSlop={10} onPress={() => startCall(item.peer, item.kind)}>
                <Ionicons name={item.kind === 'VIDEO' ? 'videocam' : 'call'} size={22} color={colors.primary} />
              </Pressable>
            </View>
          );
        }}
      />
      <Pressable style={styles.fab} onPress={() => router.push('/new-call')}>
        <Ionicons name="call" size={24} color="white" />
        <Ionicons name="add" size={14} color="white" style={styles.fabPlus} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  metaText: { fontSize: 13, color: colors.textMuted },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabPlus: { position: 'absolute', top: 12, right: 11 },
});
