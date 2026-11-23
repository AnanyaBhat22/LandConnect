/**
 * Maps use MapLibre (open source) with OpenFreeMap tiles: no API key, no
 * account, no credit card (see DECISIONS.md D4). OpenStreetMap attribution is
 * shown on the map as required by the data licence.
 */
import { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker, type CameraRef, type LngLat } from '@maplibre/maplibre-react-native';

import type { Listing } from '../api/types';
import { formatPrice } from '../lib/format';
import { colors } from '../theme';

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const DEFAULT_CENTER: LngLat = [73.8567, 18.5204]; // Pune

/** Fit all listings on screen; fall back to Pune when there are none. */
function boundsFor(listings: Listing[]) {
  if (listings.length === 0) return null;
  const lngs = listings.map((l) => l.longitude);
  const lats = listings.map((l) => l.latitude);
  const pad = 0.05;
  return [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad] as [number, number, number, number];
}

export function ListingsMap({ listings, selectedId, onSelect }: { listings: Listing[]; selectedId?: string | null; onSelect: (l: Listing) => void }) {
  const cameraRef = useRef<CameraRef>(null);
  const bounds = useMemo(() => boundsFor(listings), [listings]);

  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} compass>
      <Camera
        ref={cameraRef}
        initialViewState={bounds ? { bounds, padding: { top: 60, bottom: 220, left: 40, right: 40 } } : { center: DEFAULT_CENTER, zoom: 8 }}
      />
      {listings.map((l) => {
        const selected = l.id === selectedId;
        return (
          <Marker key={l.id} id={l.id} lngLat={[l.longitude, l.latitude]} anchor="bottom" onPress={() => onSelect(l)}>
            <Pressable onPress={() => onSelect(l)} style={[styles.pin, selected && styles.pinSelected, l.location_is_approximate && styles.pinApprox]}>
              <Text style={[styles.pinText, selected && { color: 'white' }]}>{formatPrice(l.price_inr)}</Text>
            </Pressable>
          </Marker>
        );
      })}
    </Map>
  );
}

/** Small read-only map for the listing detail screen. */
export function MiniMap({ latitude, longitude, approximate }: { latitude: number; longitude: number; approximate: boolean }) {
  return (
    <View style={styles.mini}>
      <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} compass={false}>
        <Camera initialViewState={{ center: [longitude, latitude], zoom: approximate ? 12.5 : 14 }} />
        <Marker id="here" lngLat={[longitude, latitude]} anchor={approximate ? 'center' : 'bottom'}>
          {approximate ? <View style={styles.approxCircle} /> : <View style={styles.dotPin} />}
        </Marker>
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { backgroundColor: colors.white, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, elevation: 3 },
  pinSelected: { backgroundColor: colors.primary },
  pinApprox: { borderStyle: 'dashed' },
  pinText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  mini: { height: 180, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.sand },
  approxCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(62,124,90,0.18)', borderWidth: 2, borderColor: colors.secondary },
  dotPin: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, borderWidth: 3, borderColor: 'white' },
});
