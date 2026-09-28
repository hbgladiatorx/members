/**
 * The bottom bar (Classes / Chats / Profile), shown under every screen once you're signed in,
 * not just the three main ones. Rendered once by app/_layout.tsx; the Tabs navigator's own
 * bar is turned off so there's only ever one.
 */
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { goToSection } from '../lib/nav';
import { useSocketEvent } from '../lib/socket';
import { colors, fonts } from '../lib/theme';
import type { Channel } from '../lib/types';
import { Text } from './Text';

type Section = 'classes' | 'chats' | 'profile';

const ITEMS: { key: Section; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; href: '/' | '/chats' | '/profile' }[] = [
  { key: 'classes', label: 'Classes', icon: 'school-outline', href: '/' },
  { key: 'chats', label: 'Chats', icon: 'chatbubbles-outline', href: '/chats' },
  { key: 'profile', label: 'Profile', icon: 'person-circle-outline', href: '/profile' },
];

/** Which section a screen belongs to, so its button is highlighted. */
function sectionOf(path: string): Section | null {
  if (path === '/' || /^\/(class|question|topic|members|compose)\b/.test(path)) return 'classes';
  if (/^\/(chats|chat)\b/.test(path)) return 'chats';
  if (/^\/(profile|admin|add-user)\b/.test(path)) return 'profile';
  return null; // e.g. someone else's profile
}

export function BottomNav() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const [unread, setUnread] = useState(0);
  const active = sectionOf(path);

  const refreshUnread = useCallback(() => {
    api
      .get<{ channels: Channel[] }>('/channels')
      .then((r) => setUnread(r.channels.reduce((n, c) => n + c.unread, 0)))
      .catch(() => {});
  }, []);
  // Recount on every screen change (e.g. after reading a chat) and when a message arrives.
  useEffect(refreshUnread, [path, refreshUnread]);
  useSocketEvent('message:new', refreshUnread);

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 6 : 4),
        paddingTop: 6,
      }}
    >
      {ITEMS.map((item) => {
        const on = active === item.key;
        const color = on ? colors.primary : colors.muted;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={item.key === 'chats' && unread ? `Chats, ${unread} unread` : item.label}
            onPress={() => goToSection(item.href)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 2 }}
          >
            <View>
              <Ionicons name={item.icon} size={24} color={color} />
              {item.key === 'chats' && unread > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -12,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    paddingHorizontal: 4,
                    backgroundColor: colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.onPrimary, fontSize: 11, lineHeight: 14, fontWeight: '700' }}>{unread > 99 ? '99+' : unread}</Text>
                </View>
              )}
            </View>
            <Text style={{ fontSize: 11, lineHeight: 15, marginTop: 2, color, fontFamily: fonts.semibold }}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
