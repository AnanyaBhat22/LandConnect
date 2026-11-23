/**
 * LandConnect brand elements, drawn with plain Views (no image assets):
 * - LogoMark: emerald tile with two paper-like shapes (white and pale mint)
 *   meeting at an amber dot, echoing the company logo.
 * - Wordmark: "Land" + mint "Connect" in the rounded brand font.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme';

export function LogoMark({ size = 72 }: { size?: number }) {
  const s = size / 72; // design units below are for a 72 px tile
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: 18 * s }]}>
      <View style={[styles.shape, { width: 26 * s, height: 22 * s, top: 16 * s, left: 15 * s, backgroundColor: colors.white, transform: [{ rotate: '-8deg' }, { skewY: '-6deg' }] }]} />
      <View style={[styles.shape, { width: 22 * s, height: 26 * s, bottom: 15 * s, right: 15 * s, backgroundColor: colors.paleMint, transform: [{ rotate: '6deg' }, { skewX: '-6deg' }] }]} />
      <View style={[styles.dot, { width: 9 * s, height: 9 * s, borderRadius: 4.5 * s, top: 31.5 * s, left: 31.5 * s }]} />
    </View>
  );
}

export function Wordmark({ size = 20, light = true }: { size?: number; light?: boolean }) {
  return (
    <Text style={{ fontFamily: fonts.brand, fontSize: size, color: light ? colors.white : colors.header }}>
      Land<Text style={{ color: light ? colors.mint : colors.primary }}>Connect</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.primary, overflow: 'hidden' },
  shape: { position: 'absolute', borderRadius: 2 },
  dot: { position: 'absolute', backgroundColor: colors.accent },
});
