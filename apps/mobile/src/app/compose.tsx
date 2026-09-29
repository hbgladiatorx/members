/** One modal for creating questions, discussion topics, announcements and syllabus items. */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '../components/Text';
import { placeAttachments, sendAll, type PendingAttachment } from '../components/Attachments';
import { DateField } from '../components/DateField';
import { RichInput } from '../components/RichInput';
import { Button, ErrorText, Input, styles as ui } from '../components/ui';
import { api } from '../lib/api';
import { colors, font, space } from '../lib/theme';

type Kind = 'question' | 'topic' | 'announcement' | 'syllabus';

const CONFIG: Record<Kind, { title: string; titleLabel: string; bodyLabel: string; placeholder: string; submit: string; path: (c: string) => string }> = {
  question: {
    title: 'Ask a question',
    titleLabel: 'Question',
    bodyLabel: 'Details (optional)',
    placeholder: 'What would you like to know?',
    submit: 'Post question',
    path: (c) => `/classes/${c}/questions`,
  },
  topic: {
    title: 'Start a discussion',
    titleLabel: 'Title',
    bodyLabel: 'Opening post',
    placeholder: 'What do you want to discuss?',
    submit: 'Start discussion',
    path: (c) => `/classes/${c}/topics`,
  },
  announcement: {
    title: 'New announcement',
    titleLabel: 'Headline',
    bodyLabel: 'Message',
    placeholder: 'e.g. Class moves to Room 4 this week',
    submit: 'Post announcement',
    path: (c) => `/classes/${c}/announcements`,
  },
  syllabus: {
    title: 'Add syllabus item',
    titleLabel: 'Title',
    bodyLabel: 'Details, readings, assignments',
    placeholder: 'e.g. Week 3: The rulings of prayer',
    submit: 'Save item',
    path: (c) => `/classes/${c}/syllabus`,
  },
};

export default function Compose() {
  const { kind, classId } = useLocalSearchParams<{ kind: Kind; classId: string }>();
  const cfg = CONFIG[kind] ?? CONFIG.question;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [flag, setFlag] = useState(kind === 'syllabus'); // syllabus: published; announcement: pinned
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Photos, files and links placed in the text, sent once the posting exists.
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [failed, setFailed] = useState<string[] | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { title: title.trim(), body: placeAttachments(body, pending).trim() };
      if (kind === 'syllabus') {
        payload.published = flag;
        if (dueOn.trim()) payload.dueOn = dueOn.trim();
      }
      if (kind === 'announcement') payload.pinned = flag;
      const res: any = await api.post(cfg.path(classId), payload);
      const target =
        kind === 'question'
          ? ({ targetKind: 'question', targetId: res.question.id } as const)
          : kind === 'topic'
            ? ({ targetKind: 'topic', targetId: res.topic.id } as const)
            : kind === 'announcement'
              ? ({ targetKind: 'announcement', targetId: res.announcement.id } as const)
              : ({ targetKind: 'syllabus_item', targetId: res.item.id } as const);
      const problems = await sendAll(target, pending);
      // The posting is saved either way; say which attachments didn't make it rather than losing it.
      if (problems.length) setFailed(problems);
      else if (kind === 'question') router.replace(`/question/${res.question.id}`);
      else if (kind === 'topic') router.replace(`/topic/${res.topic.id}`);
      else router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title: cfg.title,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8} style={{ marginHorizontal: 12 }}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Input label={cfg.titleLabel} value={title} onChangeText={setTitle} placeholder={cfg.placeholder} autoFocus />
        <RichInput label={cfg.bodyLabel} value={body} onChangeText={setBody} attachments={{ pending, onChange: setPending }} />
        <Text style={[font.small, { marginTop: space.sm, marginBottom: space.lg }]}>
          Photos, files (PDF, Word, PowerPoint, Excel, text; up to 25 MB) and links go where your cursor is. Only people in the class can open them.
        </Text>
        {kind === 'syllabus' && <DateField label="Date (optional)" value={dueOn} onChange={setDueOn} />}
        {(kind === 'syllabus' || kind === 'announcement') && (
          <View style={[ui.row, { justifyContent: 'space-between', marginBottom: space.lg }]}>
            <View style={{ flex: 1 }}>
              <Text style={[font.body, { fontWeight: '600' }]}>{kind === 'syllabus' ? 'Visible to students' : 'Pin to top'}</Text>
              <Text style={font.small}>{kind === 'syllabus' ? 'Turn off to keep it as a draft.' : 'Pinned announcements stay first.'}</Text>
            </View>
            <Switch value={flag} onValueChange={setFlag} trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
        )}
        {failed && (
          <View style={{ marginBottom: space.lg }}>
            <ErrorText>{`Posted, but ${failed.length === 1 ? 'this attachment' : 'these attachments'} couldn’t be added:\n${failed.join('\n')}`}</ErrorText>
            <Button variant="secondary" title="Done" onPress={() => router.back()} />
          </View>
        )}
        <ErrorText>{error}</ErrorText>
        <Button title={cfg.submit} onPress={submit} loading={busy} disabled={!!failed || title.trim().length < (kind === 'question' || kind === 'topic' ? 3 : 1)} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
