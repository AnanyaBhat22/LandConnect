import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CallPermission } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Avatar, Button, RoleBadge } from '../../components/ui';
import { colors } from '../../theme';

const CALL_OPTIONS: { value: CallPermission; label: string }[] = [
  { value: 'EVERYONE', label: 'Everyone' },
  { value: 'CONVERSATIONS', label: "People I've chatted with" },
];

export default function ProfileScreen() {
  const { user, updateMe, logout } = useAuth();
  const [saving, setSaving] = useState(false);
  if (!user) return null;

  const save = async (changes: Parameters<typeof updateMe>[0]) => {
    setSaving(true);
    try {
      await updateMe(changes);
    } catch (e: any) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.card}>
        <Avatar name={user.name} url={user.avatar_url} size={72} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.name}>{user.name}</Text>
          <RoleBadge role={user.role} />
          <Text style={styles.muted}>{user.email}</Text>
        </View>
      </View>

      <Text style={styles.section}>Privacy</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <Ionicons name="eye-outline" size={22} color={colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Show when I'm online</Text>
            <Text style={styles.muted}>Others can see if you're active</Text>
          </View>
          <Switch
            value={user.show_online_status}
            disabled={saving}
            onValueChange={(v) => save({ show_online_status: v })}
            trackColor={{ true: colors.accent }}
          />
        </View>
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <Ionicons name="call-outline" size={22} color={colors.textMuted} />
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={styles.rowTitle}>Who can call me</Text>
            {CALL_OPTIONS.map((o) => (
              <Pressable key={o.value} style={styles.option} disabled={saving} onPress={() => save({ allow_calls_from: o.value })}>
                <Ionicons name={user.allow_calls_from === o.value ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.primary} />
                <Text style={styles.optionText}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.row}>
          <Ionicons name="lock-closed-outline" size={22} color={colors.textMuted} />
          <Text style={[styles.muted, { flex: 1 }]}>
            Your email{user.phone ? ' and phone number are' : ' is'} never shown to other users. Calls and chats happen inside LandConnect.
          </Text>
        </View>
      </View>

      <Button title="Log out" variant="outline" onPress={logout} style={{ margin: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, backgroundColor: colors.white },
  name: { fontSize: 20, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  section: { fontSize: 14, fontWeight: '600', color: colors.teal, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  group: { backgroundColor: colors.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTitle: { fontSize: 16, color: colors.text },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionText: { fontSize: 15, color: colors.text },
});
