/**
 * Root of the app. Provider order matters:
 *   Auth (who am I) → Socket (needs my token) → Calls (needs the socket)
 * Stack.Protected shows the login screens or the main app depending on auth,
 * and <CallOverlay/> sits above every screen so calls can ring anywhere.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AndroidSoftInputModes, KeyboardController, KeyboardProvider } from 'react-native-keyboard-controller';

import { AuthProvider, useAuth } from '../auth/AuthContext';
import { CallProvider } from '../calls/CallContext';
import { CallOverlay } from '../calls/CallOverlay';
import { MeetingInviteListener } from '../calls/MeetingInviteListener';
import { UnreadProvider } from '../chat/UnreadContext';
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
          <Stack.Screen name="new-call" options={{ title: 'New chat or call' }} />
          <Stack.Screen name="listing/[id]" options={{ title: 'Listing' }} />
          <Stack.Screen name="listing/edit" options={{ title: 'List your land' }} />
          <Stack.Screen name="my-listings" options={{ title: 'My listings' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
          <Stack.Screen name="meetings/index" options={{ title: 'Meetings' }} />
          <Stack.Screen name="meetings/new" options={{ title: 'New meeting' }} />
          <Stack.Screen name="meeting/[id]" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {signedIn && <MeetingInviteListener />}
      <CallOverlay />
    </>
  );
}

export default function RootLayout() {
  // Fonts ship inside the JS bundle and load via expo-font (already in the
  // dev build), so adding them needs no native rebuild. If loading fails we
  // still start, falling back to the system font.
  const [loaded, error] = useFonts({ Comfortaa_600SemiBold, Comfortaa_700Bold });

  // Root cause of "the keyboard covers the input": Expo SDK 58 forces Android
  // edge-to-edge (react-native-edge-to-edge), and in edge-to-edge Android
  // IGNORES adjustResize, so the window never shrank and no keyboard-avoiding
  // logic ever triggered. adjustPan still works: the OS itself slides the
  // window up so the focused input stays visible, with no JS measuring needed.
  useEffect(() => {
    if (Platform.OS === 'android') KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_PAN);
  }, []);

  return (
    <SafeAreaProvider>
      {/* Provides KeyboardController (used above). Its own avoiding logic is not
          used: with adjustPan the OS keeps the focused input visible. */}
      <KeyboardProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <SocketProvider>
          <UnreadProvider>
          <CallProvider>
            <RootNavigator fontsReady={loaded || !!error} />
          </CallProvider>
          </UnreadProvider>
        </SocketProvider>
      </AuthProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
