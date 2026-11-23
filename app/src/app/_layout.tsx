/**
 * Root of the app. Provider order matters:
 *   Auth (who am I) → Socket (needs my token) → Calls (needs the socket)
 * Stack.Protected shows the login screens or the main app depending on auth,
 * and <CallOverlay/> sits above every screen so calls can ring anywhere.
 */
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../auth/AuthContext';
import { CallProvider } from '../calls/CallContext';
import { CallOverlay } from '../calls/CallOverlay';
import { SocketProvider } from '../realtime/SocketContext';
import { colors } from '../theme';

function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
        <ActivityIndicator color="white" size="large" />
      </View>
    );
  }

  const signedIn = status === 'signedIn';
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          headerTitleStyle: { fontWeight: '600' },
        }}
      >
        {/* Signed out: any app route (including the home "/") redirects to /login. */}
        <Stack.Protected guard={signedIn} redirectTo="/login">
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="new-call" options={{ title: 'New call' }} />
          <Stack.Screen name="listing/[id]" options={{ title: 'Listing' }} />
          <Stack.Screen name="listing/edit" options={{ title: 'List your land' }} />
          <Stack.Screen name="my-listings" options={{ title: 'My listings' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      <CallOverlay />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <SocketProvider>
          <CallProvider>
            <RootNavigator />
          </CallProvider>
        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
