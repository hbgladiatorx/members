import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Avatar, styles as ui } from './ui';
import { colors, font, space } from '../lib/theme';
import type { Channel } from '../lib/types';
import { timeAgo } from '../lib/useFetch';

export function ChannelRow({ channel: c }: { channel: Channel }) {
  const icon = c.kind === 'class' ? 'school' : c.kind === 'group' ? 'people' : null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id, name: c.name } })}
      style={({ pressed }) => [
        ui.row,
        { paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' },
      ]}
    >
      {icon ? (
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
      ) : (
        <Avatar name={c.name} size={44} />
      )}
      <View style={{ flex: 1, marginLeft: space.md }}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <Text style={[font.body, { fontWeight: c.unread ? '700' : '600', flex: 1 }]} numberOfLines={1}>
            {c.name}
          </Text>
          {c.lastAt && <Text style={[font.small, { fontSize: 12, marginLeft: space.sm }]}>{timeAgo(c.lastAt)}</Text>}
        </View>
        <View style={[ui.row, { justifyContent: 'space-between', marginTop: 2 }]}>
          <Text style={[font.small, { flex: 1, color: c.unread ? colors.text : colors.muted }]} numberOfLines={1}>
            {c.lastBody != null
              ? `${c.kind !== 'dm' && c.lastAuthor ? c.lastAuthor + ': ' : ''}${c.lastBody || 'Message deleted'}`
              : c.kind === 'group' && c.classTitle
                ? c.classTitle
                : 'No messages yet'}
          </Text>
          {c.unread > 0 && (
            <View style={{ backgroundColor: colors.accent, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginLeft: space.sm }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{c.unread > 99 ? '99+' : c.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}
