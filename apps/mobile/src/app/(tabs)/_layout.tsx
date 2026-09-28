import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { colors } from '../../lib/theme';
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
        headerTitleStyle: { fontWeight: '700', color: colors.text },
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
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
