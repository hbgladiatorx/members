/** Administrators only: find anyone with an account and make them an administrator (or not). */
import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Switch, Text, View } from 'react-native';
import { Avatar, ErrorText, Input, Loading, RoleBadge, styles as ui } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors, font, radius, space } from '../lib/theme';
import type { AdminUser } from '../lib/types';
import { useFetch } from '../lib/useFetch';

export default function AdminScreen() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const { data, error, reload } = useFetch<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q.trim())}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggle = async (u: AdminUser) => {
    setBusy(u.id);
    setActionError(null);
    try {
      await api.put(`/admin/users/${u.id}/admin`, { admin: !u.isAdmin });
      await reload();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <FlatList
      data={data?.users ?? []}
      keyExtractor={(u) => u.id}
      contentContainerStyle={{ padding: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View>
          <Stack.Screen options={{ title: 'Administrators' }} />
          <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: space.md, marginBottom: space.lg }}>
            <Text style={[font.small, { color: colors.primary }]}>
              Administrators can do everything: they see every class and act as its teacher, and they can make other
              people administrators. Teachers, assistants, students and observers are set per class, from each class’s
              Members list.
            </Text>
          </View>
          <Input value={q} onChangeText={setQ} placeholder="Search by name or email" autoCapitalize="none" autoCorrect={false} />
          <ErrorText>{actionError}</ErrorText>
        </View>
      }
      ListEmptyComponent={error ? <ErrorText>{error}</ErrorText> : !data ? <Loading /> : <Text style={font.small}>No one matches that search.</Text>}
      renderItem={({ item: u }) => (
        <View style={[ui.row, { paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }]}>
          <Avatar name={u.displayName} url={u.avatarUrl} size={40} />
          <View style={{ flex: 1, marginLeft: space.md, marginRight: space.sm }}>
            <View style={[ui.row, { gap: space.sm }]}>
              <Text style={[font.body, { fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>
                {u.displayName}
                {u.id === user?.id ? ' (you)' : ''}
              </Text>
              {u.isAdmin && <RoleBadge role="admin" />}
            </View>
            <Text style={font.small} numberOfLines={1}>{u.email}</Text>
          </View>
          <Switch
            accessibilityLabel={`${u.displayName} is an administrator`}
            value={u.isAdmin}
            disabled={busy === u.id}
            onValueChange={() => toggle(u)}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
      )}
    />
  );
}
