import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import type { Listing } from '../api/types';
import { formatArea, formatPrice, pricePerSqft } from '../lib/format';
import { colors } from '../theme';
import { RoleBadge } from './ui';

export function ListingPhoto({ listing, height }: { listing: Listing; height: number }) {
  const first = listing.images[0];
  if (first) return <Image source={{ uri: first.url }} style={{ width: '100%', height }} contentFit="cover" transition={200} />;
  // No photo yet: a calm placeholder instead of a broken image.
  return (
    <View style={[styles.placeholder, { height }]}>
      <Ionicons name="leaf-outline" size={36} color={colors.secondary} />
      <Text style={styles.placeholderText}>No photos yet</Text>
    </View>
  );
}

export function ListingCard({ listing, onPress, onToggleFavorite }: { listing: Listing; onPress: () => void; onToggleFavorite?: () => void }) {
  const area = formatArea(listing.area_sqft);
  const perSqft = pricePerSqft(listing.price_inr, listing.area_sqft);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}>
      <View>
        <ListingPhoto listing={listing} height={180} />
        {listing.images.length > 1 && (
          <View style={styles.photoCount}>
            <Ionicons name="images" size={12} color="white" />
            <Text style={styles.photoCountText}>{listing.images.length}</Text>
          </View>
        )}
        {listing.status !== 'ACTIVE' && (
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{listing.status === 'SOLD' ? 'Sold' : 'Draft'}</Text>
          </View>
        )}
        {onToggleFavorite && !listing.is_owner && (
          <Pressable style={styles.heart} onPress={onToggleFavorite} hitSlop={10}>
            <Ionicons name={listing.is_favorite ? 'heart' : 'heart-outline'} size={20} color={listing.is_favorite ? colors.danger : colors.text} />
          </Pressable>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatPrice(listing.price_inr)}</Text>
          {perSqft && <Text style={styles.muted}>{perSqft}</Text>}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {listing.title}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={14} color={colors.textMuted} />
          <Text style={styles.muted} numberOfLines={1}>
            {listing.city ?? 'Location on map'}
            {listing.location_is_approximate ? ' · approx.' : ''}
          </Text>
          {area && (
            <>
              <Text style={styles.dot}>·</Text>
              <Ionicons name="resize-outline" size={14} color={colors.textMuted} />
              <Text style={styles.muted}>{area}</Text>
            </>
          )}
        </View>
        <View style={styles.ownerRow}>
          <Text style={styles.ownerName} numberOfLines={1}>
            {listing.is_owner ? 'Your listing' : listing.owner.name}
          </Text>
          <RoleBadge role={listing.owner.role} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  placeholder: { width: '100%', backgroundColor: colors.sand, alignItems: 'center', justifyContent: 'center', gap: 6 },
  placeholderText: { color: colors.textMuted, fontSize: 13 },
  photoCount: { position: 'absolute', bottom: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoCountText: { color: 'white', fontSize: 12, fontWeight: '600' },
  statusPill: { position: 'absolute', top: 10, left: 10, backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { color: 'white', fontSize: 12, fontWeight: '700' },
  heart: { position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  body: { padding: 14, gap: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  price: { fontSize: 20, fontWeight: '700', color: colors.primary },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  muted: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  dot: { color: colors.textMuted, marginHorizontal: 2 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  ownerName: { fontSize: 13, color: colors.text, fontWeight: '500', flexShrink: 1 },
});
