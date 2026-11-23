/**
 * Video and document messages in chat.
 * - VIDEO: Cloudinary poster frame with a play button; tap opens a full-screen player (expo-video).
 * - FILE: a card with the file type, name and size; tap opens it in the phone's viewer/browser.
 */
import { Linking, Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';

export type Attachment = { url: string; name: string; size: number; mime: string; thumb?: string };

export function parseAttachment(body: string): Attachment | null {
  try {
    const a = JSON.parse(body);
    return a && typeof a.url === 'string' ? a : null;
  } catch {
    return null;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string, name: string): { icon: keyof typeof Ionicons.glyphMap; color: string; label: string } {
  const ext = name.split('.').pop()?.toUpperCase() ?? '';
  if (mime === 'application/pdf') return { icon: 'document-text', color: '#D93025', label: 'PDF' };
  if (mime.includes('word')) return { icon: 'document-text', color: '#2B579A', label: 'DOC' };
  if (mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv') return { icon: 'grid', color: '#217346', label: ext || 'XLS' };
  if (mime.includes('presentation') || mime.includes('powerpoint')) return { icon: 'easel', color: '#D24726', label: 'PPT' };
  return { icon: 'document', color: colors.secondary, label: ext || 'FILE' };
}

export function VideoBubbleContent({ att, uploading, onPress }: { att: Attachment | null; uploading: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={uploading || !att} style={styles.video}>
      {att?.thumb ? <Image source={{ uri: att.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <View style={styles.playCircle}>
        <Ionicons name={uploading ? 'cloud-upload' : 'play'} size={26} color="white" />
      </View>
      <Text style={styles.videoLabel}>{uploading ? 'Uploading video…' : `Video · ${att ? formatSize(att.size) : ''}`}</Text>
    </Pressable>
  );
}

export function FileBubbleContent({ att, uploading }: { att: Attachment | null; uploading: boolean }) {
  if (!att) return <Text style={styles.fileName}>Document</Text>;
  const f = fileIcon(att.mime, att.name);
  return (
    <Pressable style={styles.file} disabled={uploading} onPress={() => Linking.openURL(att.url)}>
      <View style={[styles.fileIcon, { backgroundColor: f.color }]}>
        <Ionicons name={f.icon} size={20} color="white" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fileName} numberOfLines={2}>
          {att.name}
        </Text>
        <Text style={styles.fileMeta}>
          {f.label} · {uploading ? 'uploading…' : formatSize(att.size)}
        </Text>
      </View>
      {!uploading && <Ionicons name="open-outline" size={18} color={colors.textMuted} />}
    </Pressable>
  );
}

export function VideoPlayerModal({ url, onClose }: { url: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(url, (p) => {
    p.play();
  });
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: 'black' }}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
        <Pressable onPress={onClose} hitSlop={12} style={[styles.close, { top: insets.top + 10 }]}>
          <Ionicons name="close" size={26} color="white" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  video: { width: 230, height: 160, borderRadius: 10, overflow: 'hidden', backgroundColor: '#1d2b26', alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  videoLabel: { position: 'absolute', left: 8, bottom: 6, color: 'white', fontSize: 12, fontWeight: '600', textShadowColor: 'black', textShadowRadius: 4 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, width: 240, paddingVertical: 4 },
  fileIcon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 14, fontWeight: '600', color: colors.text },
  fileMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  close: { position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
