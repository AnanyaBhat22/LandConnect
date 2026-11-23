/**
 * Create or edit a listing (sellers and brokers). Open with ?id= to edit.
 *
 * Flow: save the listing first (the server returns its id), then upload any
 * new photos one by one to /listings/{id}/images. Uploading separately keeps
 * each request small and lets one failed photo fail on its own.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { api, uploadFile } from '../../api/client';
import type { Listing, ListingImage, ListingInput } from '../../api/types';
import { LocationPicker, type PickedPlace } from '../../components/LocationPicker';
import { Button, TextField } from '../../components/ui';
import { colors } from '../../theme';

const MAX_PHOTOS = 8;
const SQFT_PER_ACRE = 43560;
type NewPhoto = { uri: string; name: string; type: string };

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const insets = useSafeAreaInsets(); // room for Android's nav bar below the Save button

  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [area, setArea] = useState('');
  // Land is usually described in acres; small plots in sq ft. The API stores sq ft.
  const [areaUnit, setAreaUnit] = useState<'acres' | 'sqft'>('acres');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [hideExact, setHideExact] = useState(false);
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [existing, setExisting] = useState<ListingImage[]>([]);
  const [photos, setPhotos] = useState<NewPhoto[]>([]);

  useEffect(() => {
    if (!id) return;
    api<Listing>(`/listings/${id}`)
      .then((l) => {
        setTitle(l.title);
        setDescription(l.description);
        setPrice(String(l.price_inr));
        if (l.area_sqft && l.area_sqft >= SQFT_PER_ACRE / 2) {
          setAreaUnit('acres');
          setArea(String(Number((l.area_sqft / SQFT_PER_ACRE).toFixed(2))));
        } else {
          setAreaUnit('sqft');
          setArea(l.area_sqft ? String(Math.round(l.area_sqft)) : '');
        }
        setCity(l.city ?? '');
        setAddress(l.address ?? '');
        setHideExact(l.hide_exact_location);
        setPlace({ latitude: l.latitude, longitude: l.longitude });
        setExisting(l.images);
      })
      .catch((e) => Alert.alert('Could not load listing', e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const slotsLeft = MAX_PHOTOS - existing.length - photos.length;

  const addPhotos = async (source: 'library' | 'camera') => {
    if (slotsLeft <= 0) return Alert.alert('Photo limit', `A listing can have up to ${MAX_PHOTOS} photos.`);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: source === 'library', selectionLimit: slotsLeft };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Camera permission', 'Allow camera access to take photos of the land.');
    }
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled) return;
    const picked = result.assets.slice(0, slotsLeft).map((a, i) => ({
      uri: a.uri,
      name: a.fileName ?? `photo-${Date.now()}-${i}.jpg`,
      type: a.mimeType ?? 'image/jpeg',
    }));
    setPhotos((p) => [...p, ...picked]);
  };

  const removeExisting = (img: ListingImage) =>
    Alert.alert('Remove photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/listings/${id}/images/${img.id}`, { method: 'DELETE' });
            setExisting((list) => list.filter((i) => i.id !== img.id));
          } catch (e: any) {
            Alert.alert('Could not remove photo', e.message);
          }
        },
      },
    ]);

  const save = async () => {
    const priceNum = Number(price.replace(/[^0-9]/g, ''));
    const areaValue = area ? Number(area.replace(/[^0-9.]/g, '')) : null;
    const areaNum = areaValue ? (areaUnit === 'acres' ? areaValue * SQFT_PER_ACRE : areaValue) : null;
    if (title.trim().length < 4) return Alert.alert('Add a title', 'At least 4 characters, e.g. "2 acre farmland near Lonavala".');
    if (!priceNum) return Alert.alert('Add a price', 'Enter the asking price in rupees.');
    if (!place) return Alert.alert('Set the location', 'Move the map so the pin is on the plot, or use your current location.');

    const body: ListingInput = {
      title: title.trim(),
      description: description.trim(),
      price_inr: priceNum,
      area_sqft: areaNum || null,
      latitude: place.latitude,
      longitude: place.longitude,
      city: city.trim() || null,
      address: address.trim() || null,
      hide_exact_location: hideExact,
    };

    setSaving(true);
    try {
      const saved = editing
        ? await api<Listing>(`/listings/${id}`, { method: 'PATCH', body })
        : await api<Listing>('/listings', { method: 'POST', body });
      let failed = 0;
      let lastError = '';
      console.log(`[listing] saved ${saved.id}; uploading ${photos.length} photo(s)`);
      for (let i = 0; i < photos.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${photos.length}…`);
        try {
          await uploadFile(`/listings/${saved.id}/images`, photos[i]);
        } catch (e: any) {
          failed++;
          lastError = e?.message ?? String(e);
          // Visible in the dev server log, so failures are never silent.
          console.warn('[listing] photo upload failed', { uri: photos[i].uri, type: photos[i].type, error: lastError });
        }
      }
      if (failed) Alert.alert('Some photos failed', `${failed} of ${photos.length} photo(s) couldn't be uploaded.\n\nReason: ${lastError}\n\nYou can add them again from Edit.`);
      router.replace({ pathname: '/listing/[id]', params: { id: saved.id } });
    } catch (e: any) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: editing ? 'Edit listing' : 'List your land' }} />
      {/* Scrolls the focused field above the keyboard (works with edge-to-edge Android). */}
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[styles.container, { paddingBottom: 48 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Photos</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {existing.map((img) => (
            <Pressable key={img.id} onLongPress={() => removeExisting(img)}>
              <Image source={{ uri: img.url }} style={styles.thumb} contentFit="cover" />
              <Pressable style={styles.thumbRemove} onPress={() => removeExisting(img)} hitSlop={6}>
                <Ionicons name="close" size={14} color="white" />
              </Pressable>
            </Pressable>
          ))}
          {photos.map((p, i) => (
            <View key={p.uri}>
              <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" />
              <Pressable style={styles.thumbRemove} onPress={() => setPhotos((list) => list.filter((_, j) => j !== i))} hitSlop={6}>
                <Ionicons name="close" size={14} color="white" />
              </Pressable>
            </View>
          ))}
          {slotsLeft > 0 && (
            <>
              <Pressable style={styles.addThumb} onPress={() => addPhotos('library')}>
                <Ionicons name="images-outline" size={26} color={colors.secondary} />
                <Text style={styles.addText}>Gallery</Text>
              </Pressable>
              <Pressable style={styles.addThumb} onPress={() => addPhotos('camera')}>
                <Ionicons name="camera-outline" size={26} color={colors.secondary} />
                <Text style={styles.addText}>Camera</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
        <Text style={styles.hint}>Up to {MAX_PHOTOS} photos. Clear daytime photos of the plot and road access work best.</Text>

        <Text style={styles.section}>Details</Text>
        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="e.g. 2 acre farmland near Lonavala" maxLength={120} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <TextField label="Price (₹)" value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder="4500000" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label={`Area (${areaUnit === 'acres' ? 'acres' : 'sq ft'})`}
              value={area}
              onChangeText={setArea}
              keyboardType="decimal-pad"
              placeholder={areaUnit === 'acres' ? '2.5' : '2400'}
            />
          </View>
        </View>
        <View style={styles.unitRow}>
          <Text style={styles.hint}>Area unit</Text>
          <View style={styles.unitToggle}>
            {(['acres', 'sqft'] as const).map((u) => (
              <Pressable
                key={u}
                onPress={() => {
                  // Convert the number already typed so switching units doesn't change the size.
                  const n = Number(area.replace(/[^0-9.]/g, ''));
                  if (n && u !== areaUnit) setArea(u === 'sqft' ? String(Math.round(n * SQFT_PER_ACRE)) : String(Number((n / SQFT_PER_ACRE).toFixed(3))));
                  setAreaUnit(u);
                }}
                style={[styles.unitBtn, areaUnit === u && styles.unitActive]}
              >
                <Text style={[styles.unitText, areaUnit === u && { color: 'white' }]}>{u === 'acres' ? 'Acres' : 'Sq ft'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Soil, water, road access, title status, nearby landmarks…"
          multiline
          style={styles.multiline}
          maxLength={4000}
        />

        <Text style={styles.section}>Location</Text>
        <LocationPicker
          initial={place}
          onChange={(p) => {
            setPlace(p);
            if (p.city) setCity(p.city);
            if (p.address) setAddress(p.address);
          }}
        />
        <View style={{ height: 12 }} />
        <TextField label="City / village" value={city} onChangeText={setCity} placeholder="Lonavala" />
        <TextField label="Address or landmark" value={address} onChangeText={setAddress} placeholder="Survey no., village, taluka" />

        <View style={styles.privacy}>
          <View style={{ flex: 1 }}>
            <Text style={styles.privacyTitle}>Hide exact location</Text>
            <Text style={styles.hint}>Buyers see an approximate area (about 1 km) and no street address until you share it.</Text>
          </View>
          <Switch value={hideExact} onValueChange={setHideExact} trackColor={{ true: colors.secondary }} />
        </View>

        {progress && <Text style={styles.progress}>{progress}</Text>}
        <Button title={editing ? 'Save changes' : 'Publish listing'} onPress={save} loading={saving} style={{ marginTop: 8 }} />
      </KeyboardAwareScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 18, paddingBottom: 48, backgroundColor: colors.background },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 12, marginBottom: 10 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 17 },
  thumb: { width: 96, height: 96, borderRadius: 12 },
  thumbRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  addThumb: { width: 96, height: 96, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.secondary, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.sand },
  addText: { fontSize: 12, color: colors.secondary, fontWeight: '600' },
  multiline: { height: 110, paddingTop: 12, textAlignVertical: 'top' },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.sand, padding: 14, borderRadius: 12, marginTop: 4, marginBottom: 12 },
  privacyTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  progress: { textAlign: 'center', color: colors.secondary, marginBottom: 8 },
  unitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -6, marginBottom: 14 },
  unitToggle: { flexDirection: 'row', borderRadius: 16, borderWidth: 1.5, borderColor: colors.primary, overflow: 'hidden' },
  unitBtn: { paddingHorizontal: 16, paddingVertical: 6 },
  unitActive: { backgroundColor: colors.primary },
  unitText: { fontSize: 13, fontWeight: '600', color: colors.primary },
});
