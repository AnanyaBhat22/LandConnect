import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { Button, TextField } from '../components/ui';
import { LogoMark, Wordmark } from '../components/Brand';
import { colors, fonts } from '../theme';

const DEMO_ACCOUNTS = [
  { label: 'Buyer', email: 'asha@example.com' },
  { label: 'Seller', email: 'ravi@example.com' },
  { label: 'Broker', email: 'meera@example.com' },
];

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e = email, p = password) => {
    setError(null);
    setLoading(true);
    try {
      await login(e.trim(), p);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {/* Hero styled after LandConnect's own banner. */}
          <View style={styles.hero}>
            <LogoMark size={76} />
            <Wordmark size={34} />
            <Text style={styles.tagline}>Privacy. Confidentiality.</Text>
          </View>
          <View style={styles.container}>
          <Text style={styles.subtitle}>Buy, sell and broker land. Chat and call without sharing your number.</Text>

          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="••••••••" />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button title="Log in" onPress={() => submit()} loading={loading} />

          <Text style={styles.footer}>
            New here?{' '}
            <Link href="/register" style={styles.link}>
              Create an account
            </Link>
          </Text>

          <View style={styles.demoBox}>
            <Text style={styles.demoTitle}>Demo accounts (password demo1234)</Text>
            <View style={styles.demoRow}>
              {DEMO_ACCOUNTS.map((a) => (
                <Pressable key={a.email} style={styles.demoChip} onPress={() => submit(a.email, 'demo1234')}>
                  <Text style={styles.demoChipText}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.header },
  hero: { backgroundColor: colors.header, alignItems: 'center', gap: 14, paddingTop: 40, paddingBottom: 44 },
  tagline: { color: colors.paleMint, fontSize: 14, letterSpacing: 2.5, fontFamily: fonts.heading },
  container: { flexGrow: 1, padding: 24, backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -20 },
  subtitle: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: 4, marginBottom: 24, lineHeight: 21 },
  error: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
  footer: { textAlign: 'center', marginTop: 20, color: colors.textMuted, fontSize: 15 },
  link: { color: colors.secondary, fontWeight: '600' },
  demoBox: { marginTop: 32, padding: 16, backgroundColor: colors.surface, borderRadius: 12 },
  demoTitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: 10 },
  demoRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  demoChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  demoChipText: { color: colors.primary, fontWeight: '600' },
});
