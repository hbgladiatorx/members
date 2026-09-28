import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Avatar, Button, Card, ErrorText, Input, Loading, Pill, styles as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { colors, font, space } from '../../lib/theme';
import { isStaffRole, type ClassSummary, type Post, type Topic } from '../../lib/types';
import { timeAgo, useFetch } from '../../lib/useFetch';

export default function TopicScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, setData, error } = useFetch<{ topic: Topic }>(`/topics/${id}`);
  const t = data?.topic;
  const cls = useFetch<{ class: ClassSummary }>(t ? `/classes/${t.classId}` : null);
  const staff = isStaffRole(cls.data?.class.role);
  const [reply, setReply] = useState('');
  const [replyTo, setReplyTo] = useState<Post | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Build a reply tree from the flat list.
  const tree = useMemo(() => {
    const children = new Map<string | null, Post[]>();
    for (const p of t?.posts ?? []) {
      const k = p.parentId ?? null;
      children.set(k, [...(children.get(k) ?? []), p]);
    }
    return children;
  }, [t]);

  const submit = async () => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await api.post<{ topic: Topic }>(`/topics/${id}/posts`, { body: reply.trim(), parentId: replyTo?.id ?? null }));
      setReply('');
      setReplyTo(null);
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const moderate = async (patch: { pinned?: boolean; locked?: boolean }) => {
    try {
      setData(await api.patch<{ topic: Topic }>(`/topics/${id}`, patch));
    } catch (e: any) {
      setActionError(e.message);
    }
  };

  if (!t) return error ? <View style={{ padding: space.lg }}><ErrorText>{error}</ErrorText></View> : <Loading />;

  const renderPosts = (parentId: string | null, depth: number): React.ReactNode =>
    (tree.get(parentId) ?? []).map((p) => (
      <View key={p.id} style={depth ? { marginLeft: Math.min(depth, 3) * 16, borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: space.md } : undefined}>
        <View style={{ paddingVertical: space.md }}>
          {p.deleted ? (
            <Text style={[font.small, { fontStyle: 'italic' }]}>This reply was removed.</Text>
          ) : (
            <>
              <View style={[ui.row, { gap: space.sm, marginBottom: 4 }]}>
                <Avatar name={p.author!.displayName} size={24} />
                <Text style={[font.body, { fontWeight: '600', fontSize: 14 }]}>{p.author!.displayName}</Text>
                <Text style={[font.small, { fontSize: 12 }]}>{timeAgo(p.createdAt)}{p.editedAt ? ' · edited' : ''}</Text>
              </View>
              <Text style={font.body}>{p.body}</Text>
              {(!t.locked || staff) && (
                <Pressable onPress={() => setReplyTo(p)} style={[ui.row, { marginTop: 6 }]} hitSlop={6}>
                  <Ionicons name="return-down-forward-outline" size={14} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600', marginLeft: 4 }}>Reply</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
        {renderPosts(p.id, depth + 1)}
      </View>
    ));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        <View style={[ui.row, { gap: space.sm, marginBottom: space.sm }]}>
          {t.pinned && <Pill text="Pinned" tone="accent" icon="pin" />}
          {t.locked && <Pill text="Locked" icon="lock-closed" />}
        </View>
        <Text style={font.title}>{t.title}</Text>
        <Text style={[font.small, { marginTop: 4 }]}>
          Started by {t.author.displayName} · {timeAgo(t.createdAt)}
        </Text>
        {!!t.body && <Text style={[font.body, { marginTop: space.lg }]}>{t.body}</Text>}

        {staff && (
          <View style={[ui.row, { gap: space.sm, marginTop: space.lg }]}>
            <Button small variant="secondary" icon="pin-outline" title={t.pinned ? 'Unpin' : 'Pin'} onPress={() => moderate({ pinned: !t.pinned })} />
            <Button small variant="secondary" icon={t.locked ? 'lock-open-outline' : 'lock-closed-outline'} title={t.locked ? 'Unlock' : 'Lock'} onPress={() => moderate({ locked: !t.locked })} />
          </View>
        )}

        <Text style={[font.label, { marginTop: space.xl }]}>
          {t.posts.length} repl{t.posts.length === 1 ? 'y' : 'ies'}
        </Text>
        <Card style={{ marginTop: space.sm, paddingVertical: space.sm }}>
          {t.posts.length ? renderPosts(null, 0) : <Text style={[font.small, { paddingVertical: space.md }]}>Be the first to reply.</Text>}
        </Card>

        <ErrorText>{actionError}</ErrorText>
        {t.locked && !staff ? (
          <View style={[ui.row, { justifyContent: 'center', padding: space.lg }]}>
            <Ionicons name="lock-closed" size={14} color={colors.muted} />
            <Text style={[font.small, { marginLeft: 6 }]}>This discussion is locked.</Text>
          </View>
        ) : (
          <Card>
            {replyTo && (
              <View style={[ui.row, { justifyContent: 'space-between', marginBottom: space.sm }]}>
                <Text style={font.small} numberOfLines={1}>
                  Replying to {replyTo.author?.displayName}
                </Text>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                  <Ionicons name="close" size={16} color={colors.muted} />
                </Pressable>
              </View>
            )}
            <Input value={reply} onChangeText={setReply} multiline placeholder="Add to the discussion…" />
            <Button title="Reply" onPress={submit} loading={busy} disabled={!reply.trim()} />
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
