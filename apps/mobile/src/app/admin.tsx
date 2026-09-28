/** Administrators only: everyone with an account. Add people, reset passwords, and choose administrators. */
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Switch, Text, View } from 'react-native';
import { TemporaryPasswordCard } from '../components/TemporaryPassword';
import { Avatar, Button, ErrorText, Input, Loading, Pill, RoleBadge, styles as ui } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors, font, radius, space } from '../lib/theme';
import type { AdminUser } from '../lib/types';
import { useFetch } from '../lib/useFetch';

export default function PeopleScreen() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const { data, error, reload } = useFetch<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q.trim())}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [reset, setReset] = useState<{ user: AdminUser; password: string } | null>(null);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setActionError(null);
    try {
      await fn();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleAdmin = (u: AdminUser) =>
    run(u.id, async () => {
      await api.put(`/admin/users/${u.id}/admin`, { admin: !u.isAdmin });
      await reload();
    });

  const resetPassword = (u: AdminUser) =>
    run(u.id, async () => {
      const r = await api.post<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`);
      setConfirmReset(null);
      setReset({ user: u, password: r.temporaryPassword });
      await reload();
    });

  return (
    <FlatList
      data={data?.users ?? []}
      keyExtractor={(u) => u.id}
      contentContainerStyle={{ padding: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View>
          <Stack.Screen options={{ title: 'People' }} />
          <Button icon="person-add-outline" title="Add user" onPress={() => router.push('/add-user')} />
          <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: space.md, marginVertical: space.lg }}>
            <Text style={[font.small, { color: colors.primary }]}>
              The switch makes someone an administrator: they see every class, act as its teacher, and can manage people
              here. Teachers, assistants, students and observers are set per class, from each class’s Members list.
            </Text>
          </View>
          {reset && (
            <TemporaryPasswordCard
              title={`New temporary password for ${reset.user.displayName}`}
              email={reset.user.email}
              password={reset.password}
              onDismiss={() => setReset(null)}
            />
          )}
          <Input value={q} onChangeText={setQ} placeholder="Search by name or email" autoCapitalize="none" autoCorrect={false} />
          <ErrorText>{actionError}</ErrorText>
        </View>
      }
      ListEmptyComponent={error ? <ErrorText>{error}</ErrorText> : !data ? <Loading /> : <Text style={font.small}>No one matches that search.</Text>}
      renderItem={({ item: u }) => {
        const me = u.id === user?.id;
        return (
          <View style={{ paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={ui.row}>
              <Avatar name={u.displayName} url={u.avatarUrl} size={40} />
              <View style={{ flex: 1, marginLeft: space.md, marginRight: space.sm }}>
                <View style={[ui.row, { gap: space.sm, flexWrap: 'wrap' }]}>
                  <Text style={[font.body, { fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>
                    {u.displayName}
                    {me ? ' (you)' : ''}
                  </Text>
                  {u.isAdmin && <RoleBadge role="admin" />}
                  {u.mustChangePassword && <Pill text="Temporary password" icon="key-outline" />}
                </View>
                <Text style={font.small} numberOfLines={1}>{u.email}</Text>
              </View>
              <Switch
                accessibilityLabel={`${u.displayName} is an administrator`}
                value={u.isAdmin}
                disabled={busy === u.id}
                onValueChange={() => toggleAdmin(u)}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
            {!me && (
              <View style={[ui.row, { marginTop: space.sm, marginLeft: 52, gap: space.md }]}>
                {confirmReset === u.id ? (
                  <>
                    <Text style={font.small}>Sign them out and make a new temporary password?</Text>
                    <Pressable onPress={() => resetPassword(u)} disabled={busy === u.id} hitSlop={6}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>Reset</Text>
                    </Pressable>
                    <Pressable onPress={() => setConfirmReset(null)} hitSlop={6}>
                      <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => setConfirmReset(u.id)} hitSlop={6}>
                    <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>Reset password</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        );
      }}
    />
  );
}
