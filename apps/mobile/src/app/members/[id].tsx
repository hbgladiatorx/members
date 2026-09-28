import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Avatar, ErrorText, Loading, RoleBadge, styles as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, font, space } from '../../lib/theme';
import { ROLE_LABELS, type Member, type Role } from '../../lib/types';
import { useFetch } from '../../lib/useFetch';

export default function MembersScreen() {
  const { id, role } = useLocalSearchParams<{ id: string; role: Role }>();
  const { user } = useAuth();
  const { data, error, reload } = useFetch<{ members: Member[] }>(`/classes/${id}/members`);
  const [open, setOpen] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const instructor = role === 'instructor';

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      setOpen(null);
      await reload();
    } catch (e: any) {
      setActionError(e.message);
    }
  };

  const message = (m: Member) =>
    run(async () => {
      const r = await api.post<{ channelId: string }>('/dm', { userId: m.id });
      router.push({ pathname: '/chat/[id]', params: { id: r.channelId, name: m.displayName } });
    });

  return (
    <FlatList
      data={data?.members ?? []}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ paddingVertical: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center' }}
      ListHeaderComponent={actionError ? <View style={{ paddingHorizontal: space.lg }}><ErrorText>{actionError}</ErrorText></View> : null}
      ListEmptyComponent={error ? <ErrorText>{error}</ErrorText> : <Loading />}
      renderItem={({ item: m }) => {
        const me = m.id === user?.id;
        const expanded = open === m.id;
        const hasActions = !me && (instructor || (role !== 'observer' && m.role !== 'observer'));
        return (
          <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Pressable onPress={() => router.push(`/user/${m.id}`)} style={[ui.row, { paddingHorizontal: space.lg, paddingVertical: space.md }]}>
              <Avatar name={m.displayName} url={m.avatarUrl} size={40} />
              <View style={{ flex: 1, marginLeft: space.md }}>
                <Text style={[font.body, { fontWeight: '600' }]}>
                  {m.displayName}
                  {me ? ' (you)' : ''}
                </Text>
                <View style={{ marginTop: 2 }}>
                  <RoleBadge role={m.role} />
                </View>
              </View>
              {hasActions && (
                <Pressable
                  accessibilityLabel={`Actions for ${m.displayName}`}
                  onPress={() => setOpen(expanded ? null : m.id)}
                  hitSlop={10}
                  style={{ padding: 6 }}
                >
                  <Ionicons name={expanded ? 'chevron-up' : 'ellipsis-horizontal'} size={18} color={colors.muted} />
                </Pressable>
              )}
            </Pressable>
            {expanded && (
              <View style={[ui.row, { flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md, paddingLeft: 72 }]}>
                {role !== 'observer' && m.role !== 'observer' && (
                  <Chip icon="chatbubble-outline" label="Message" onPress={() => message(m)} />
                )}
                {instructor &&
                  (['student', 'assistant', 'instructor', 'observer'] as Role[])
                    .filter((r) => r !== m.role)
                    .map((r) => (
                      <Chip
                        key={r}
                        icon={r === 'observer' ? 'eye-outline' : 'swap-horizontal'}
                        label={`Make ${ROLE_LABELS[r]}`}
                        onPress={() => run(() => api.patch(`/classes/${id}/members/${m.id}`, { role: r }))}
                      />
                    ))}
                {instructor && <Chip danger icon="person-remove-outline" label="Remove" onPress={() => run(() => api.del(`/classes/${id}/members/${m.id}`))} />}
              </View>
            )}
          </View>
        );
      }}
    />
  );
}

function Chip({ icon, label, onPress, danger }: { icon: any; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        ui.row,
        {
          paddingHorizontal: space.md,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
        },
      ]}
    >
      <Ionicons name={icon} size={14} color={danger ? colors.danger : colors.primary} />
      <Text style={{ marginLeft: 4, fontSize: 13, fontWeight: '600', color: danger ? colors.danger : colors.primary }}>{label}</Text>
    </Pressable>
  );
}
