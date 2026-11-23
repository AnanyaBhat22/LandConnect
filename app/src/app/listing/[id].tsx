/**
 * Listing detail: photos, price, location, description, and the owner card.
 * Buyers contact the owner with in-app voice/video calls (no phone number is
 * ever shown). Owners get edit / mark sold / delete instead.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { api } from '../../api/client';
import type { Listing } from '../../api/types';
import { useCalls } from '../../calls/CallContext';
import { ListingPhoto } from '../../components/ListingCard';
import { MiniMap } from '../../components/LandMap';
import { Avatar, Button, RoleBadge } from '../../components/ui';
import { formatArea, formatPrice, pricePerSqft } from '../../lib/format';
import { colors } from '../../theme';

const WIDTH = Dimensions.get('window').width;

function Fact({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={20} color={colors.secondary} />
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { startCall } = useCalls();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setListing(await api<Listing>(`/listings/${id}`));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!listing) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Listing' }} />
        {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.primary} size="large" />}
      </View>
    );
  }

  const toggleFavorite = async () => {
    const next = !listing.is_favorite;
    setListing({ ...listing, is_favorite: next });
    try {
      await api(`/listings/${listing.id}/favorite`, { method: next ? 'POST' : 'DELETE' });
    } catch {
      setListing({ ...listing, is_favorite: !next });
    }
  };

  const setStatus = async (status: 'ACTIVE' | 'SOLD') => {
    setBusy(true);
    try {
      setListing(await api<Listing>(`/listings/${listing.id}`, { method: 'PATCH', body: { status } }));
    } catch (e: any) {
      Alert.alert('Could not update', e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert('Delete listing?', 'This removes the listing and its photos permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/listings/${listing.id}`, { method: 'DELETE' });
            router.back();
          } catch (e: any) {
            Alert.alert('Could not delete', e.message);
          }
        },
      },
    ]);

  const area = formatArea(listing.area_sqft);
  const perSqft = pricePerSqft(listing.price_inr, listing.area_sqft);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: listing.city ?? 'Listing',
          headerRight: () =>
            listing.is_owner ? null : (
              <Pressable onPress={toggleFavorite} hitSlop={10}>
                <Ionicons name={listing.is_favorite ? 'heart' : 'heart-outline'} size={24} color="white" />
              </Pressable>
            ),
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: listing.is_owner ? 32 : 110 }}>
        {listing.images.length ? (
          <View>
            <FlatList
              data={listing.images}
              keyExtractor={(i) => i.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / WIDTH))}
              renderItem={({ item }) => <Image source={{ uri: item.url }} style={{ width: WIDTH, height: 260 }} contentFit="cover" transition={200} />}
            />
            {listing.images.length > 1 && (
              <View style={styles.dots}>
                {listing.images.map((img, i) => (
                  <View key={img.id} style={[styles.dot, i === photo && styles.dotActive]} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <ListingPhoto listing={listing} height={200} />
        )}

        <View style={styles.section}>
          {listing.status !== 'ACTIVE' && (
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>{listing.status === 'SOLD' ? 'Sold' : 'Draft'}</Text>
            </View>
          )}
          <Text style={styles.price}>{formatPrice(listing.price_inr)}</Text>
          <Text style={styles.title}>{listing.title}</Text>
          <View style={styles.facts}>
            {area && <Fact icon="resize-outline" label="Area" value={area} />}
            {perSqft && <Fact icon="pricetag-outline" label="Rate" value={perSqft} />}
            <Fact icon="location-outline" label="City" value={listing.city ?? '—'} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Location</Text>
          <MiniMap latitude={listing.latitude} longitude={listing.longitude} approximate={listing.location_is_approximate} />
          <Text style={styles.muted}>
            {listing.location_is_approximate
              ? '🔒 Approximate area. The seller shares the exact spot after you get in touch.'
              : listing.address ?? `${listing.latitude.toFixed(5)}, ${listing.longitude.toFixed(5)}`}
          </Text>
        </View>

        {listing.description ? (
          <View style={styles.section}>
            <Text style={styles.heading}>About this land</Text>
            <Text style={styles.description}>{listing.description}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.heading}>{listing.is_owner ? 'Manage' : 'Listed by'}</Text>
          {listing.is_owner ? (
            <View style={{ gap: 10 }}>
              <Button title="Edit listing" onPress={() => router.push({ pathname: '/listing/edit', params: { id: listing.id } })} />
              <Button
                title={listing.status === 'SOLD' ? 'Mark as available' : 'Mark as sold'}
                variant="outline"
                loading={busy}
                onPress={() => setStatus(listing.status === 'SOLD' ? 'ACTIVE' : 'SOLD')}
              />
              <Button title="Delete listing" variant="danger" onPress={confirmDelete} />
            </View>
          ) : (
            <View style={styles.ownerCard}>
              <Avatar name={listing.owner.name} url={listing.owner.avatar_url} size={52} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.ownerName}>{listing.owner.name}</Text>
                <RoleBadge role={listing.owner.role} />
                {listing.owner.bio ? <Text style={styles.muted} numberOfLines={2}>{listing.owner.bio}</Text> : null}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {!listing.is_owner && (
        <View style={styles.contactBar}>
          <Pressable style={[styles.contactBtn, styles.chatBtn]} onPress={() => Alert.alert('Chat is coming next', 'Messaging is the next feature being built. For now, call the owner in the app.')}>
            <Ionicons name="chatbubble-ellipses" size={20} color={colors.primary} />
            <Text style={[styles.contactText, { color: colors.primary }]}>Chat</Text>
          </Pressable>
          <Pressable style={styles.contactBtn} onPress={() => startCall(listing.owner, 'AUDIO')}>
            <Ionicons name="call" size={20} color="white" />
            <Text style={styles.contactText}>Call</Text>
          </Pressable>
          <Pressable style={styles.contactBtn} onPress={() => startCall(listing.owner, 'VIDEO')}>
            <Ionicons name="videocam" size={20} color="white" />
            <Text style={styles.contactText}>Video</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: 'white', width: 18 },
  section: { paddingHorizontal: 18, paddingTop: 18, gap: 10 },
  statusPill: { alignSelf: 'flex-start', backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { color: 'white', fontSize: 12, fontWeight: '700' },
  price: { fontSize: 28, fontWeight: '800', color: colors.primary },
  title: { fontSize: 19, fontWeight: '600', color: colors.text, marginTop: -4 },
  facts: { flexDirection: 'row', gap: 10, marginTop: 4 },
  fact: { flex: 1, backgroundColor: colors.sand, borderRadius: 12, padding: 12, gap: 3 },
  factLabel: { fontSize: 12, color: colors.textMuted },
  factValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  heading: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  ownerCard: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: colors.sand, padding: 14, borderRadius: 14 },
  ownerName: { fontSize: 16, fontWeight: '600', color: colors.text },
  contactBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, padding: 14, paddingBottom: 22, backgroundColor: colors.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  contactBtn: { flex: 1, height: 50, borderRadius: 25, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chatBtn: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.primary },
  contactText: { color: 'white', fontSize: 15, fontWeight: '600' },
});
