/**
 * Geotagging for a listing: the pin stays fixed in the centre and the seller
 * moves the MAP under it (like ride-hailing apps). That's easier to control
 * with a finger than dragging a tiny marker. "Use my location" jumps to GPS,
 * and the phone's built-in geocoder suggests the city and address.
 */
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Camera, Map, type CameraRef, type LngLat } from '@maplibre/maplibre-react-native';

import { colors } from '../theme';
import { DEFAULT_CENTER, MAP_STYLE } from './LandMap';

export type PickedPlace = { latitude: number; longitude: number; city?: string | null; address?: string | null };

async function describe(latitude: number, longitude: number): Promise<{ city: string | null; address: string | null }> {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!place) return { city: null, address: null };
    const city = place.city ?? place.subregion ?? place.district ?? null;
    const address = [place.name, place.street, place.district, city, place.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    return { city, address: address || null };
  } catch {
    return { city: null, address: null }; // geocoding is a nice-to-have
  }
}

export function LocationPicker({ initial, onChange }: { initial?: { latitude: number; longitude: number } | null; onChange: (p: PickedPlace) => void }) {
  const cameraRef = useRef<CameraRef>(null);
  const [center, setCenter] = useState<LngLat>(initial ? [initial.longitude, initial.latitude] : DEFAULT_CENTER);
  const [label, setLabel] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const settle = async ([lng, lat]: LngLat) => {
    setCenter([lng, lat]);
    const info = await describe(lat, lng);
    setLabel(info.address ?? info.city);
    onChange({ latitude: lat, longitude: lng, ...info });
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission', 'Allow location access to drop the pin where you are, or move the map yourself.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next: LngLat = [pos.coords.longitude, pos.coords.latitude];
      cameraRef.current?.flyTo({ center: next, zoom: 16, duration: 800 });
      await settle(next);
    } catch {
      Alert.alert('Location unavailable', "Couldn't get your position. Move the map to the plot instead.");
    } finally {
      setLocating(false);
    }
  };

  return (
    <View>
      <View style={styles.map}>
        <Map
          style={StyleSheet.absoluteFill}
          mapStyle={MAP_STYLE}
          logo={false}
          onRegionDidChange={(e) => {
            if (e.nativeEvent.userInteraction) settle(e.nativeEvent.center);
          }}
        >
          <Camera ref={cameraRef} initialViewState={{ center, zoom: initial ? 15 : 10 }} />
        </Map>
        {/* Fixed centre pin, drawn above the map. */}
        <View pointerEvents="none" style={styles.centerPin}>
          <Ionicons name="location" size={42} color={colors.accent} />
        </View>
        <Pressable style={styles.gps} onPress={useMyLocation} disabled={locating}>
          {locating ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="locate" size={22} color={colors.primary} />}
        </Pressable>
      </View>
      <Text style={styles.hint}>
        {label ? `📍 ${label}` : 'Move the map so the pin sits on the plot, or tap the target button for your current location.'}
      </Text>
      <Text style={styles.coords}>
        {center[1].toFixed(5)}, {center[0].toFixed(5)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 260, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.sand },
  centerPin: { position: 'absolute', top: '50%', left: '50%', marginLeft: -21, marginTop: -40 },
  gps: { position: 'absolute', right: 12, bottom: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', elevation: 3 },
  hint: { fontSize: 13, color: colors.text, marginTop: 8, lineHeight: 18 },
  coords: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
