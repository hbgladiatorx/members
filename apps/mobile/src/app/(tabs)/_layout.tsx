import { Tabs } from 'expo-router';
import { HeaderLogo } from '../../components/ui';
import { colors, fonts } from '../../lib/theme';

/**
 * The three main screens. Their bottom bar is drawn by app/_layout.tsx (components/BottomNav)
 * so it also shows on every other screen; the Tabs navigator's own bar is turned off.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{
        headerTitleStyle: { fontFamily: fonts.bold, color: colors.text },
        headerRight: () => <HeaderLogo />,
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Classes' }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
