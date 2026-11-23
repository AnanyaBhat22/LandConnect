/** "My listings" (sellers/brokers, any status) or "Saved" (favourites), depending on ?mode=. */
import { FlatList, RefreshControl, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListingCard } from '../components/ListingCard';
import { Button, EmptyState } from '../components/ui';
import { useListings } from '../lib/useListings';
import { colors } from '../theme';

export default function MyListingsScreen() {
  const { mode } = useLocalSearchParams<{ mode?: 'mine' | 'saved' }>();
  const saved = mode === 'saved';
  const insets = useSafeAreaInsets();
  const { items, loading, error, reload, toggleFavorite } = useListings(saved ? { favorites: true } : { mine: true });

  return (
    <View style={{ flex: 1, backgroundColor: colors.sand }}>
      <Stack.Screen options={{ title: saved ? 'Saved land' : 'My listings' }} />
      <FlatList
        data={items}
        keyExtractor={(l) => l.id}
        contentContainerStyle={items.length ? { padding: 14, gap: 14, paddingBottom: 14 + insets.bottom } : { flex: 1 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} colors={[colors.primary]} />}
        ListEmptyComponent={
          loading ? undefined : (
            <EmptyState
              icon={<Ionicons name={saved ? 'heart-outline' : 'home-outline'} size={60} color={colors.secondary} />}
              title={error ?? (saved ? 'Nothing saved yet' : "You haven't listed any land yet")}
              subtitle={saved ? 'Tap the heart on a listing to save it here.' : undefined}
            >
              {!saved && <Button title="List a plot" onPress={() => router.push('/listing/edit')} style={{ marginTop: 16 }} />}
            </EmptyState>
          )
        }
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            onPress={() => router.push({ pathname: '/listing/[id]', params: { id: item.id } })}
            onToggleFavorite={saved ? () => toggleFavorite(item) : undefined}
          />
        )}
      />
    </View>
  );
}
