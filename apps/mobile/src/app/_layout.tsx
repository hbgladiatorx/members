// Import each weight on its own so only these font files ship with the app.
import { OpenSans_400Regular } from '@expo-google-fonts/open-sans/400Regular';
import { OpenSans_600SemiBold } from '@expo-google-fonts/open-sans/600SemiBold';
import { OpenSans_700Bold } from '@expo-google-fonts/open-sans/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { SocketProvider } from '../lib/socket';
import { colors, fonts } from '../lib/theme';

function RootNavigator() {
  const { user, loading } = useAuth();
  // The brand font (Open Sans). If it fails to load, carry on with the system font.
  const [fontsLoaded, fontError] = useFonts({
    [fonts.regular]: OpenSans_400Regular,
    [fonts.semibold]: OpenSans_600SemiBold,
    [fonts.bold]: OpenSans_700Bold,
  });
  if (loading || (!fontsLoaded && !fontError)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text, fontFamily: fonts.bold },
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user?.mustChangePassword}>
        <Stack.Screen name="change-password" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user && !user.mustChangePassword}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="class/[id]" options={{ title: '' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Stack.Screen name="question/[id]" options={{ title: 'Question' }} />
        <Stack.Screen name="topic/[id]" options={{ title: 'Discussion' }} />
        <Stack.Screen name="compose" options={{ presentation: 'modal', title: 'New' }} />
        <Stack.Screen name="members/[id]" options={{ title: 'Members' }} />
        <Stack.Screen name="user/[id]" options={{ title: 'Profile' }} />
        <Stack.Screen name="admin" options={{ title: 'People' }} />
        <Stack.Screen name="add-user" options={{ presentation: 'modal', title: 'Add user' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SocketProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
