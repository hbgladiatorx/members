import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '../../components/Text';
import { Avatar, Button, Card, ErrorText, Input, Loading, Pill, RoleBadge, styles as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, font, space } from '../../lib/theme';
import { canParticipate, type ClassSummary, type Question } from '../../lib/types';
import { formatStamp, useFetch } from '../../lib/useFetch';
import { RichText } from '../../components/RichText';
import { RichInput } from '../../components/RichInput';

export default function QuestionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data, setData, error } = useFetch<{ question: Question }>(`/questions/${id}`);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const q = data?.question;
  const cls = useFetch<{ class: ClassSummary }>(q ? `/classes/${q.classId}` : null);
  const participant = canParticipate(cls.data?.class.role);

  const run = async (fn: () => Promise<void>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e: any) {
      setActionError(e.message);
    }
  };
  const refresh = async () => setData(await api.get(`/questions/${id}`));

  const vote = (kind: 'questions' | 'answers', targetId: string, current: number | null, value: 1 | -1) =>
    run(async () => {
      await api.put(`/${kind}/${targetId}/vote`, { value: current === value ? 0 : value });
      await refresh();
    });

  const accept = (answerId: string | null) =>
    run(async () => setData(await api.post<{ question: Question }>(`/questions/${id}/accept`, { answerId })));

  const submit = () =>
    run(async () => {
      setBusy(true);
      try {
        setData(await api.post<{ question: Question }>(`/questions/${id}/answers`, { body: answer.trim() }));
        setAnswer('');
      } finally {
        setBusy(false);
      }
    });

  if (!q) return error ? <View style={{ padding: space.lg }}><ErrorText>{error}</ErrorText></View> : <Loading />;
  const isAsker = q.author.id === user?.id;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        <View style={ui.row}>
          <Voter score={q.score} myVote={q.myVote} disabled={isAsker || !participant} onVote={(v) => vote('questions', q.id, q.myVote, v)} />
          <View style={{ flex: 1, marginLeft: space.md }}>
            <Text style={font.title}>{q.title}</Text>
            <Text style={[font.small, { marginTop: 4 }]}>
              Asked by {q.author.displayName} · {formatStamp(q.createdAt)}
            </Text>
          </View>
        </View>
        {!!q.body && <View style={{ marginTop: space.lg }}><RichText text={q.body} /></View>}

        <Text style={[font.label, { marginTop: space.xl, marginBottom: space.sm }]}>
          {q.answers.length} answer{q.answers.length === 1 ? '' : 's'}
        </Text>
        <ErrorText>{actionError}</ErrorText>

        {q.answers.map((a) => (
          <Card key={a.id} style={a.accepted ? { borderColor: colors.success, borderWidth: 1.5 } : undefined}>
            {a.accepted && (
              <View style={{ marginBottom: space.sm }}>
                <Pill text="Accepted answer" tone="success" icon="checkmark-circle" />
              </View>
            )}
            <View style={[ui.row, { alignItems: 'flex-start' }]}>
              <Voter score={a.score} myVote={a.myVote} disabled={a.author.id === user?.id || !participant} onVote={(v) => vote('answers', a.id, a.myVote, v)} />
              <View style={{ flex: 1, marginLeft: space.md }}>
                <RichText text={a.body} />
                <Pressable onPress={() => router.push(`/user/${a.author.id}`)} style={[ui.row, { marginTop: space.md, gap: space.sm }]}>
                  <Avatar name={a.author.displayName} url={a.author.avatarUrl} size={22} />
                  <Text style={[font.small, { fontSize: 12 }]}>
                    {a.author.displayName} · {formatStamp(a.createdAt)}
                  </Text>
                  {a.author.role && <RoleBadge role={a.author.role} />}
                </Pressable>
                {isAsker && participant && (
                  <Pressable onPress={() => accept(a.accepted ? null : a.id)} style={[ui.row, { marginTop: space.md }]}>
                    <Ionicons name={a.accepted ? 'close-circle-outline' : 'checkmark-circle-outline'} size={16} color={colors.success} />
                    <Text style={{ color: colors.success, fontWeight: '600', marginLeft: 4, fontSize: 13 }}>
                      {a.accepted ? 'Unaccept' : 'Accept this answer'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </Card>
        ))}

        {participant && (
          <Card style={{ marginTop: space.md }}>
            <RichInput label="Your answer" value={answer} onChangeText={setAnswer} placeholder="Share what you know…" />
            <Button title="Post answer" onPress={submit} loading={busy} disabled={!answer.trim()} />
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Voter({ score, myVote, disabled, onVote }: { score: number; myVote: number | null; disabled?: boolean; onVote: (v: 1 | -1) => void }) {
  return (
    <View style={{ alignItems: 'center', width: 36, opacity: disabled ? 0.45 : 1 }}>
      <Pressable accessibilityLabel="Upvote" disabled={disabled} onPress={() => onVote(1)} hitSlop={8}>
        <Ionicons name={myVote === 1 ? 'caret-up' : 'caret-up-outline'} size={24} color={myVote === 1 ? colors.primary : colors.muted} />
      </Pressable>
      <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>{score}</Text>
      <Pressable accessibilityLabel="Downvote" disabled={disabled} onPress={() => onVote(-1)} hitSlop={8}>
        <Ionicons name={myVote === -1 ? 'caret-down' : 'caret-down-outline'} size={24} color={myVote === -1 ? colors.danger : colors.muted} />
      </Pressable>
    </View>
  );
}
