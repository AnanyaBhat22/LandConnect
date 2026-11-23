import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSocket } from '../../realtime/SocketContext';
import { useUnread } from '../../chat/UnreadContext';
import { Wordmark } from '../../components/Brand';
import { colors, fonts } from '../../theme';

/** Small dot in the header: green when the realtime connection is live. */
function ConnectionDot() {
  const { connected } = useSocket();
  return <View style={{ width: 10, height: 10, borderRadius: 5, marginRight: 16, backgroundColor: connected ? colors.success : '#FFB02E' }} />;
}

export default function TabsLayout() {
  const { unread } = useUnread();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: colors.white,
        headerTitleStyle: { fontFamily: fonts.heading },
        headerRight: () => <ConnectionDot />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Chats', headerTitle: () => <Wordmark size={21} />, tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined, tabBarBadgeStyle: { backgroundColor: colors.accent }, tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="community"
        options={{ title: 'Community', tabBarIcon: ({ color, size }) => <Ionicons name="map" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="calls"
        options={{ title: 'Calls', tabBarIcon: ({ color, size }) => <Ionicons name="call" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color as string} size={size} /> }}
      />
    </Tabs>
  );
}
