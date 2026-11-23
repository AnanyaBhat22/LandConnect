/**
 * Community: browse land as a feed or on a map. Sellers and brokers get a
 * "+" button to list land; buyers don't (the server enforces this too).
 */
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Listing } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { ListingCard } from '../../components/ListingCard';
import { ListingsMap } from '../../components/LandMap';
import { EmptyState } from '../../components/ui';
import { useListings } from '../../lib/useListings';
import { colors } from '../../theme';

export default function CommunityScreen() {
  const { user } = useAuth();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Listing | null>(null);
  const { items, total, loading, error, reload, toggleFavorite } = useListings({ q });
  const canList = user?.role === 'SELLER' || user?.role === 'BROKER';

  // Search 400 ms after the user stops typing.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const open = (l: Listing) => router.push({ pathname: '/listing/[id]', params: { id: l.id } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.sand }}>
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.search}
            placeholder="Search by place or keyword"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.toggle}>
          {(['list', 'map'] as const).map((v) => (
            <Pressable key={v} onPress={() => setView(v)} style={[styles.toggleBtn, view === v && styles.toggleActive]}>
              <Ionicons name={v === 'list' ? 'list' : 'map'} size={18} color={view === v ? 'white' : colors.primary} />
            </Pressable>
          ))}
        </View>
      </View>

      {view === 'list' ? (
        <FlatList
          data={items}
          keyExtractor={(l) => l.id}
          contentContainerStyle={items.length ? styles.list : { flex: 1 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} colors={[colors.primary]} />}
          ListHeaderComponent={items.length ? <Text style={styles.count}>{total} plot{total === 1 ? '' : 's'} available</Text> : undefined}
          ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
          ListEmptyComponent={
            loading ? undefined : (
              <EmptyState
                icon={<Ionicons name="map-outline" size={60} color={colors.secondary} />}
                title={error ?? (q ? `No land matching "${q}"` : 'No land listed yet')}
                subtitle={error ? 'Pull down to retry.' : canList ? 'Tap + to list your first plot.' : 'Check back soon.'}
              />
            )
          }
          renderItem={({ item }) => <ListingCard listing={item} onPress={() => open(item)} onToggleFavorite={() => toggleFavorite(item)} />}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <ListingsMap listings={items} selectedId={selected?.id} onSelect={setSelected} />
          {selected && (
            <View style={styles.mapCard}>
              <ListingCard listing={selected} onPress={() => open(selected)} />
              <Pressable style={styles.mapCardClose} onPress={() => setSelected(null)} hitSlop={10}>
                <Ionicons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>
          )}
        </View>
      )}

      {canList && (
        <Pressable style={styles.fab} onPress={() => router.push('/listing/edit')}>
          <Ionicons name="add" size={30} color="white" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 42, borderRadius: 21, backgroundColor: colors.sand },
  search: { flex: 1, fontSize: 15, color: colors.text },
  toggle: { flexDirection: 'row', borderRadius: 21, borderWidth: 1.5, borderColor: colors.primary, overflow: 'hidden' },
  toggleBtn: { width: 42, height: 39, alignItems: 'center', justifyContent: 'center' },
  toggleActive: { backgroundColor: colors.primary },
  list: { padding: 14, paddingBottom: 100 },
  count: { fontSize: 13, color: colors.textMuted, marginBottom: 10 },
  mapCard: { position: 'absolute', left: 12, right: 12, bottom: 16 },
  mapCardClose: { position: 'absolute', top: 8, left: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 5 },
});
