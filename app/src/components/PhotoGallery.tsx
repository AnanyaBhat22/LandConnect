/**
 * Listing photos without cropping.
 *
 * Phone photos are often portrait while the gallery is landscape. Instead of
 * cropping ('cover', which cut off most of the plot), each slide shows the
 * whole photo ('contain') over a blurred, zoomed copy of itself, so there are
 * no empty bars. Tapping opens a full-screen, swipeable viewer.
 */
import { useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ListingImage } from '../api/types';

const { width: WIDTH, height: HEIGHT } = Dimensions.get('window');
const GALLERY_HEIGHT = Math.round(WIDTH * 0.75); // 4:3, a natural photo shape

function Slide({ url, height, onPress }: { url: string; height: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: WIDTH, height, backgroundColor: '#0D1C16' }}>
      <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} />
      <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} />
    </Pressable>
  );
}

function Dots({ count, index }: { count: number; index: number }) {
  if (count < 2) return null;
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
      ))}
    </View>
  );
}

export function PhotoGallery({ images }: { images: ListingImage[] }) {
  const [index, setIndex] = useState(0);
  const [viewer, setViewer] = useState(false);

  return (
    <View>
      <FlatList
        data={images}
        keyExtractor={(i) => i.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / WIDTH))}
        renderItem={({ item }) => <Slide url={item.url} height={GALLERY_HEIGHT} onPress={() => setViewer(true)} />}
      />
      <Dots count={images.length} index={index} />
      <View style={styles.expandHint}>
        <Ionicons name="expand" size={14} color="white" />
      </View>
      {viewer && <FullScreenViewer images={images} start={index} onClose={() => setViewer(false)} />}
    </View>
  );
}

function FullScreenViewer({ images, start, onClose }: { images: ListingImage[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: 'black' }}>
        <FlatList
          data={images}
          keyExtractor={(i) => i.id}
          horizontal
          pagingEnabled
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({ length: WIDTH, offset: WIDTH * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / WIDTH))}
          renderItem={({ item }) => <Image source={{ uri: item.url }} style={{ width: WIDTH, height: HEIGHT }} contentFit="contain" />}
        />
        <View style={[styles.viewerTop, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <Ionicons name="close" size={26} color="white" />
          </Pressable>
          <Text style={styles.counter}>
            {index + 1} / {images.length}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: 'white', width: 18 },
  expandHint: { position: 'absolute', right: 12, bottom: 10, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, padding: 6 },
  viewerTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  counter: { color: 'white', fontSize: 15, fontWeight: '600' },
});
