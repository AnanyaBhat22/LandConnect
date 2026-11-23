import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Button, TextField } from '../components/ui';
import { colors, roleColors } from '../theme';

const ROLES: { role: Role; icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  { role: 'BUYER', icon: 'search', title: 'Buyer', text: 'Browse land, chat and call sellers' },
  { role: 'SELLER', icon: 'home', title: 'Seller', text: 'List your own land for sale' },
  { role: 'BROKER', icon: 'briefcase', title: 'Broker', text: 'Manage listings for your clients' },
];

export default function RegisterScreen() {
  const { register } = useAuth();
  const [role, setRole] = useState<Role>('BUYER');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters');
    setLoading(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password, role, phone: phone.trim() || undefined });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Create account</Text>

          <Text style={styles.section}>I am a…</Text>
          {ROLES.map((r) => {
            const selected = r.role === role;
            return (
              <Pressable
                key={r.role}
                onPress={() => setRole(r.role)}
                style={[styles.roleCard, selected && { borderColor: roleColors[r.role], backgroundColor: roleColors[r.role] + '10' }]}
              >
                <View style={[styles.roleIcon, { backgroundColor: roleColors[r.role] }]}>
                  <Ionicons name={r.icon} size={20} color="white" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleTitle}>{r.title}</Text>
                  <Text style={styles.roleText}>{r.text}</Text>
                </View>
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? roleColors[r.role] : colors.textMuted} />
              </Pressable>
            );
          })}

          <View style={{ height: 16 }} />
          <TextField label="Full name" value={name} onChangeText={setName} placeholder="Your name" autoComplete="name" />
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
          <TextField label="Password (min 8 characters)" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" />
          <TextField label="Phone (optional, kept private)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91…" />
          <View style={styles.privacy}>
            <Ionicons name="lock-closed" size={14} color={colors.secondary} />
            <Text style={styles.privacyText}>Your email and phone are never shown to other users. People reach you through in-app chat and calls only.</Text>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}
          <Button title="Create account" onPress={submit} loading={loading} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginTop: 16, marginBottom: 20 },
  section: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 10 },
  roleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, marginBottom: 10 },
  roleIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  roleTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  roleText: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  privacy: { flexDirection: 'row', gap: 8, backgroundColor: colors.surface, padding: 12, borderRadius: 10, marginBottom: 16 },
  privacyText: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  error: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
});
