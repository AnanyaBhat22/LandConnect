import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api } from '../api/client';
import type { UserPublic } from '../api/types';
import { useCalls } from '../calls/CallContext';
import { Avatar, EmptyState, RoleBadge } from '../components/ui';
import { colors } from '../theme';

export default function NewCallScreen() {
  const { startCall } = useCalls();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search as you type, waiting 300 ms after the last keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setResults(await api<UserPublic[]>(`/users?q=${encodeURIComponent(q)}`));
        setError(null);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.search}
          placeholder="Search people by name"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
        {loading && <ActivityIndicator color={colors.primary} />}
      </View>
      <FlatList
        data={results}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={results.length === 0 ? { flex: 1 } : undefined}
        ListEmptyComponent={
          <EmptyState
            icon={<Ionicons name="people-outline" size={56} color={colors.teal} />}
            title={error ?? (query.trim().length < 2 ? 'Find buyers, sellers and brokers' : loading ? 'Searching…' : 'No one found')}
            subtitle="Try a demo account: Asha, Ravi or Meera"
          />
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Avatar name={item.name} url={item.avatar_url} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.name}>{item.name}</Text>
              <RoleBadge role={item.role} />
            </View>
            <Pressable hitSlop={10} onPress={() => startCall(item, 'AUDIO')} style={styles.action}>
              <Ionicons name="call" size={22} color={colors.primary} />
            </Pressable>
            <Pressable hitSlop={10} onPress={() => startCall(item, 'VIDEO')} style={styles.action}>
              <Ionicons name="videocam" size={24} color={colors.primary} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 12, paddingHorizontal: 14, height: 46, borderRadius: 23, backgroundColor: colors.surface },
  search: { flex: 1, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  action: { padding: 8 },
});
