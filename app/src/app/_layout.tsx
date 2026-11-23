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
import { colors, fonts } from '../theme';
import { Comfortaa_600SemiBold, Comfortaa_700Bold, useFonts } from '@expo-google-fonts/comfortaa';

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useAuth();

  if (status === 'loading' || !fontsReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.header }}>
        <ActivityIndicator color="white" size="large" />
      </View>
    );
  }

  const signedIn = status === 'signedIn';
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: colors.white,
          headerTitleStyle: { fontFamily: fonts.heading },
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
  // Fonts ship inside the JS bundle and load via expo-font (already in the
  // dev build), so adding them needs no native rebuild. If loading fails we
  // still start, falling back to the system font.
  const [loaded, error] = useFonts({ Comfortaa_600SemiBold, Comfortaa_700Bold });
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <SocketProvider>
          <CallProvider>
            <RootNavigator fontsReady={loaded || !!error} />
          </CallProvider>
        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
