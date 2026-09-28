import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { Platform, View } from 'react-native';
import { Logo } from '../../components/ui';
import { colors, fonts } from '../../lib/theme';
import type { Channel } from '../../lib/types';
import { useFocusEffect } from 'expo-router';

export default function TabsLayout() {
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => {
    api
      .get<{ channels: Channel[] }>('/channels')
      .then((r) => setUnread(r.channels.reduce((n, c) => n + c.unread, 0)))
      .catch(() => {});
  }, []);
  useFocusEffect(refreshUnread);
  useSocketEvent('message:new', refreshUnread);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerTitleStyle: { fontFamily: fonts.bold, color: colors.text },
        // Open Sans is taller than the system font: give the label its full line so it isn't clipped.
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
        headerLeft: () => (
          <View style={{ marginLeft: 16 }}>
            <Logo variant="mark" width={30} />
          </View>
        ),
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        // On web the bar has a fixed height; make room for Open Sans. Phones size it themselves (safe area included).
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, ...(Platform.OS === 'web' ? { height: 58 } : null) },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Classes',
          tabBarIcon: ({ color, size }) => <Ionicons name="school-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent },
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
