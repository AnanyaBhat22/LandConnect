/**
 * WhatsApp-style attachment sheet: slides up from the bottom with round,
 * colour-coded options. Replaces the stock Android alert, whose button
 * layout was cramped and inconsistent.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';

type Option = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void };

export function AttachSheet({ visible, onClose, onDocument, onGallery, onCamera }: {
  visible: boolean;
  onClose: () => void;
  onDocument: () => void;
  onGallery: () => void;
  onCamera: () => void;
}) {
  const insets = useSafeAreaInsets();
  const options: Option[] = [
    { key: 'doc', label: 'Document', icon: 'document-text', color: '#7F66FF', onPress: onDocument },
    { key: 'gallery', label: 'Photo or video', icon: 'images', color: '#C861FA', onPress: onGallery },
    { key: 'camera', label: 'Camera', icon: 'camera', color: '#FF2E74', onPress: onCamera },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: 24 + insets.bottom }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Share</Text>
        <View style={styles.row}>
          {options.map((o) => (
            <Pressable
              key={o.key}
              style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
              onPress={() => {
                onClose();
                // Let the sheet close before the system picker opens.
                setTimeout(o.onPress, 250);
              }}
            >
              <View style={[styles.circle, { backgroundColor: o.color }]}>
                <Ionicons name={o.icon} size={26} color="white" />
              </View>
              <Text style={styles.label}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Videos up to 1 minute (40 MB) · documents up to 10 MB</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 24 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  option: { alignItems: 'center', gap: 8, width: 96 },
  circle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, color: colors.text, textAlign: 'center' },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 20 },
});
