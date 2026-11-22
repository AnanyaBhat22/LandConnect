import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState } from '../../components/ui';
import { colors } from '../../theme';

// Placeholder until messaging is built (next step in the plan).
export default function ChatsScreen() {
  return (
    <EmptyState
      icon={<Ionicons name="chatbubbles-outline" size={64} color={colors.teal} />}
      title="Chats are coming next"
      subtitle="Messaging lands in the next step. Meanwhile, you can find people and call them in the app."
    >
      <Button title="Find people to call" onPress={() => router.push('/new-call')} style={{ marginTop: 16 }} />
    </EmptyState>
  );
}
