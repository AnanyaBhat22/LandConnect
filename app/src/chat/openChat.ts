import { Alert } from 'react-native';
import { router } from 'expo-router';

import { api } from '../api/client';
import type { Conversation } from '../api/types';

/** Open (or create) the chat with a user, optionally about a listing, then navigate to it. */
export async function openChat(userId: string, listingId?: string): Promise<void> {
  try {
    const conv = await api<Conversation>('/conversations', { method: 'POST', body: { user_id: userId, listing_id: listingId ?? null } });
    router.push({ pathname: '/chat/[id]', params: { id: conv.id } });
  } catch (e: any) {
    Alert.alert("Couldn't open chat", e.message);
  }
}
