/** Create a meeting (sellers and brokers): title, optional listing, invite people. */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../../api/client';
import type { Listing, ListingPage, Meeting, UserPublic } from '../../api/types';
import { Avatar, Button, RoleBadge, TextField } from '../../components/ui';
import { colors } from '../../theme';

export default function NewMeetingScreen() {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingId, setListingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserPublic[]>([]);
  const [searching, setSearching] = useState(false);
  const [invited, setInvited] = useState<UserPublic[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<ListingPage>('/listings?mine=true&limit=50')
      .then((p) => setListings(p.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults([]);
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await api<UserPublic[]>(`/users?q=${encodeURIComponent(q)}`));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const toggle = (u: UserPublic) =>
    setInvited((list) => (list.some((x) => x.id === u.id) ? list.filter((x) => x.id !== u.id) : [...list, u]));

  const create = async () => {
    if (title.trim().length < 3) return Alert.alert('Add a title', 'For example "Site discussion – Lonavala plot".');
    if (!invited.length) return Alert.alert('Invite someone', 'Search for at least one person to invite.');
    setSaving(true);
    try {
      const m = await api<Meeting>('/meetings', { method: 'POST', body: { title: title.trim(), listing_id: listingId, invitee_ids: invited.map((u) => u.id) } });
      router.replace({ pathname: '/meeting/[id]', params: { id: m.id } }); // host joins right away
    } catch (e: any) {
      Alert.alert('Could not create meeting', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { paddingBottom: 40 + insets.bottom }]}>
      <Stack.Screen options={{ title: 'New meeting' }} />
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Site discussion – Lonavala plot" maxLength={120} />

      {listings.length > 0 && (
        <>
          <Text style={styles.label}>About a listing (optional)</Text>
          <View style={styles.chips}>
            {listings.map((l) => {
              const on = l.id === listingId;
              return (
                <Pressable key={l.id} onPress={() => setListingId(on ? null : l.id)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && { color: 'white' }]} numberOfLines={1}>
                    {l.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.label}>Invite people</Text>
      {invited.length > 0 && (
        <View style={styles.chips}>
          {invited.map((u) => (
            <Pressable key={u.id} onPress={() => toggle(u)} style={[styles.chip, styles.chipOn, styles.personChip]}>
              <Text style={[styles.chipText, { color: 'white' }]}>{u.name}</Text>
              <Ionicons name="close" size={14} color="white" />
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="Search by name (try Asha or Meera)" placeholderTextColor={colors.textMuted} />
        {searching && <ActivityIndicator color={colors.primary} />}
      </View>
      {results.map((u) => {
        const on = invited.some((x) => x.id === u.id);
        return (
          <Pressable key={u.id} style={styles.row} onPress={() => toggle(u)}>
            <Avatar name={u.name} url={u.avatar_url} size={40} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.name}>{u.name}</Text>
              <RoleBadge role={u.role} />
            </View>
            <Ionicons name={on ? 'checkmark-circle' : 'add-circle-outline'} size={26} color={on ? colors.primary : colors.textMuted} />
          </Pressable>
        );
      })}

      <Button title="Start meeting" onPress={create} loading={saving} style={{ marginTop: 24 }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, backgroundColor: colors.background, flexGrow: 1 },
  label: { fontSize: 13, color: colors.textMuted, fontWeight: '500', marginTop: 6, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1.5, borderColor: colors.primary, maxWidth: '100%' },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  personChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 46, borderRadius: 23, backgroundColor: colors.sand },
  search: { flex: 1, fontSize: 15, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
});
