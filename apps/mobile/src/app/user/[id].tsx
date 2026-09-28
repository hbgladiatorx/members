/** A member's profile as the viewer is allowed to see it. */
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '../../components/Text';
import { Avatar, Button, Card, ErrorText, Loading, Pill, RoleBadge, SectionHeader, styles as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { colors, font, radius, space } from '../../lib/theme';
import type { Profile } from '../../lib/types';
import { useFetch } from '../../lib/useFetch';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error } = useFetch<{ profile: Profile }>(`/users/${id}/profile`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const p = data?.profile;

  if (!p) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title: 'Profile' }} />
        {error ? (
          <View style={{ padding: space.lg }}>
            <ErrorText>{error.includes('not found') ? 'This profile is only visible to people in the same class.' : error}</ErrorText>
          </View>
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  const message = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.post<{ channelId: string }>('/dm', { userId: p.id });
      router.push({ pathname: '/chat/[id]', params: { id: r.channelId, name: p.displayName } });
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Highest role across shared classes, for the header badge.
  const topRole = (['instructor', 'assistant', 'observer'] as const).find((r) => p.sharedClasses.some((c) => c.role === r));
  // In the self-preview, show exactly what classmates see.
  const visibleEmail = p.isSelf && !p.showEmail ? null : p.email;
  const hasDetails = p.city || p.languages.length || p.helpWith || visibleEmail;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <Stack.Screen options={{ title: p.isSelf ? 'Your public profile' : p.displayName }} />

      {p.isSelf && (
        <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: space.md, marginBottom: space.lg }}>
          <Text style={[font.small, { color: colors.primary }]}>
            This is how classmates see you. Your email is {p.showEmail ? 'shown' : 'hidden'}; change it in Profile.
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={{ alignItems: 'center' }}>
        <Avatar name={p.displayName} url={p.avatarUrl} size={112} />
        <Text style={[font.title, { marginTop: space.md, textAlign: 'center' }]}>{p.displayName}</Text>
        {topRole && (
          <View style={{ marginTop: 6 }}>
            <RoleBadge role={topRole} />
          </View>
        )}
        {!!p.bio && <Text style={[font.body, { textAlign: 'center', marginTop: space.md, color: colors.text, maxWidth: 440 }]}>{p.bio}</Text>}
        {!p.isSelf && (
          <View style={{ marginTop: space.lg, width: '100%', maxWidth: 320 }}>
            {p.canMessage ? (
              <Button icon="chatbubble-outline" title="Message" onPress={message} loading={busy} />
            ) : (
              <View style={[ui.row, { justifyContent: 'center' }]}>
                <Ionicons name="notifications-off-outline" size={14} color={colors.muted} />
                <Text style={[font.small, { marginLeft: 6 }]}>{p.displayName.split(' ')[0]} isn’t accepting direct messages</Text>
              </View>
            )}
          </View>
        )}
        <ErrorText>{actionError}</ErrorText>
      </View>

      {/* Activity */}
      <View style={[ui.row, { marginTop: space.xl, gap: space.sm }]}>
        <Stat n={p.stats.questionsAsked} label="Questions" />
        <Stat n={p.stats.answersGiven} label="Answers" />
        <Stat n={p.stats.answersAccepted} label="Accepted" highlight />
        <Stat n={p.stats.topicsStarted} label="Discussions" />
      </View>

      {hasDetails ? (
        <>
          <SectionHeader title="Details" />
          <Card>
            {!!p.city && <Detail icon="location-outline" label="City" value={p.city} />}
            {p.languages.length > 0 && <Detail icon="language-outline" label="Languages" value={p.languages.join(', ')} />}
            {!!p.helpWith && <Detail icon="hand-left-outline" label="Can help with" value={p.helpWith} />}
            {!!visibleEmail && <Detail icon="mail-outline" label="Email" value={visibleEmail} />}
          </Card>
        </>
      ) : null}

      <SectionHeader title={p.isSelf ? 'Your classes' : 'Classes together'} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {p.sharedClasses.length === 0 ? (
          <Text style={[font.small, { padding: space.lg }]}>No classes yet.</Text>
        ) : (
          p.sharedClasses.map((c, i) => (
            <View
              key={c.id}
              style={[ui.row, { justifyContent: 'space-between', padding: space.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }]}
            >
              <Text style={[font.body, { fontWeight: '600', flex: 1 }]} onPress={() => router.push(`/class/${c.id}`)}>
                {c.title}
              </Text>
              {c.role === 'student' ? <Pill text="Student" /> : <RoleBadge role={c.role} />}
            </View>
          ))
        )}
      </Card>

      <Text style={[font.small, { textAlign: 'center', marginTop: space.xl }]}>
        Member since {new Date(p.memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      </Text>
      <View style={{ height: space.xl }} />
    </ScrollView>
  );
}

function Stat({ n, label, highlight }: { n: number; label: string; highlight?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: space.md,
        backgroundColor: highlight && n > 0 ? colors.successSoft : colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: highlight && n > 0 ? colors.successBorder : colors.border,
      }}
    >
      <Text style={{ fontSize: 20, fontWeight: '800', color: highlight && n > 0 ? colors.success : colors.text }}>{n}</Text>
      <Text style={[font.small, { fontSize: 11 }]}>{label}</Text>
    </View>
  );
}

function Detail({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={[ui.row, { alignItems: 'flex-start', paddingVertical: 6 }]}>
      <Ionicons name={icon} size={18} color={colors.primary} style={{ marginTop: 1, marginRight: space.md }} />
      <View style={{ flex: 1 }}>
        <Text style={[font.small, { fontSize: 12 }]}>{label}</Text>
        <Text style={font.body} selectable>
          {value}
        </Text>
      </View>
    </View>
  );
}
