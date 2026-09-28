import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, Card, Empty, ErrorText, Loading, Pill, RoleBadge, SectionHeader, Segmented, styles as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvent } from '../../lib/socket';
import { AttachmentAdder, AttachmentList } from '../../components/Attachments';
import { brand, colors, font, radius, space } from '../../lib/theme';
import { canParticipate, isStaffRole, type Announcement, type ClassSummary, type QuestionSummary, type SyllabusItem, type TopicSummary } from '../../lib/types';
import { formatDate, timeAgo, useFetch } from '../../lib/useFetch';

type Tab = 'overview' | 'qa' | 'discuss';

export default function ClassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const cls = useFetch<{ class: ClassSummary }>(`/classes/${id}`);
  const { user } = useAuth();
  const c = cls.data?.class;
  const staff = isStaffRole(c?.role);
  const participant = canParticipate(c?.role);

  if (!c) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title: '' }} />
        {cls.error ? <View style={{ padding: space.lg }}><ErrorText>{cls.error}</ErrorText></View> : <Loading />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: c.title }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={cls.refreshing} onRefresh={cls.reload} tintColor={colors.primary} />}
      >
        {/* Class header */}
        <View style={{ marginBottom: space.lg }}>
          <View style={[ui.row, { gap: space.sm, marginBottom: 6 }]}>
            <RoleBadge role={user?.isAdmin ? 'admin' : c.role} />
            {c.archivedAt && <Pill text="Archived" icon="archive-outline" />}
          </View>
          <Text style={font.title}>{c.title}</Text>
          {!!c.description && <Text style={[font.body, { color: colors.muted, marginTop: 4 }]}>{c.description}</Text>}
          {!participant && (
            <View style={[ui.row, { marginTop: space.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: space.md }]}>
              <Ionicons name="eye-outline" size={16} color={colors.muted} />
              <Text style={[font.small, { marginLeft: space.sm, flex: 1 }]}>
                You’re observing this class. You can read everything students see, but you can’t post, answer or chat.
              </Text>
            </View>
          )}
          {staff && c.joinCode && (
            <Pressable
              onPress={() => Share.share({ message: `Join "${c.title}" on Mainstay Classes with code ${c.joinCode}` })}
              style={{
                marginTop: space.md,
                flexDirection: 'row',
                alignItems: 'center',
                alignSelf: 'flex-start',
                backgroundColor: colors.accentSoft,
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
              }}
            >
              <Ionicons name="key-outline" size={15} color={colors.accentText} />
              <Text style={{ marginLeft: 6, color: colors.accentText, fontWeight: '600' }}>Join code</Text>
              <Text style={{ marginLeft: 8, color: colors.text, fontWeight: '800', letterSpacing: 2, fontSize: 16 }}>{c.joinCode}</Text>
              <Ionicons name="share-outline" size={15} color={colors.accentText} style={{ marginLeft: 8 }} />
            </Pressable>
          )}
          <View style={[ui.row, { gap: space.sm, marginTop: space.lg }]}>
            <Button
              small
              icon="chatbubbles"
              title="Class chat"
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.channelId!, name: c.title } })}
              style={{ flex: 1 }}
            />
            <Button
              small
              variant="secondary"
              icon="people-outline"
              title={`Members · ${c.memberCount}`}
              onPress={() => router.push({ pathname: '/members/[id]', params: { id: c.id, role: c.role } })}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview', icon: 'book-outline' },
            { value: 'qa', label: 'Q&A', icon: 'help-circle-outline' },
            { value: 'discuss', label: 'Discuss', icon: 'chatbox-ellipses-outline' },
          ]}
        />

        {tab === 'overview' && <Overview classId={c.id} staff={staff} />}
        {tab === 'qa' && <QA classId={c.id} participant={participant} />}
        {tab === 'discuss' && <Discussions classId={c.id} participant={participant} />}
      </ScrollView>
    </View>
  );
}

const compose = (kind: string, classId: string) => router.push({ pathname: '/compose', params: { kind, classId } });

function Overview({ classId, staff }: { classId: string; staff: boolean }) {
  const ann = useFetch<{ announcements: Announcement[] }>(`/classes/${classId}/announcements`);
  const syl = useFetch<{ items: SyllabusItem[] }>(`/classes/${classId}/syllabus`);
  const [open, setOpen] = useState<string | null>(null);
  const onAnnouncement = useCallback(() => ann.refetch(), [ann.refetch]);
  useSocketEvent('announcement:new', onAnnouncement);

  const publish = async (item: SyllabusItem) => {
    await api.patch(`/syllabus/${item.id}`, { published: !item.published });
    syl.refetch();
  };

  return (
    <View>
      <SectionHeader
        title="Announcements"
        action={staff ? <Button small variant="ghost" icon="add" title="Post" onPress={() => compose('announcement', classId)} /> : undefined}
      />
      {!ann.data ? (
        <Loading />
      ) : ann.data.announcements.length === 0 ? (
        <Text style={[font.small, { marginBottom: space.md }]}>No announcements yet.</Text>
      ) : (
        ann.data.announcements.map((a) => (
          <Card key={a.id} style={a.pinned ? { borderColor: brand.beige, backgroundColor: colors.accentSoft } : undefined}>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={[font.body, { fontWeight: '700', flex: 1 }]}>{a.title}</Text>
              {a.pinned && <Ionicons name="pin" size={15} color={colors.accent} />}
            </View>
            {!!a.body && <Text style={[font.body, { marginTop: 4 }]}>{a.body}</Text>}
            <Text style={[font.small, { marginTop: space.sm, fontSize: 12 }]}>
              {a.author.displayName} · {timeAgo(a.createdAt)}
            </Text>
            <AttachmentList items={a.attachments ?? []} canEdit={staff} onChanged={ann.refetch} />
            {staff && <AttachHere target={{ targetKind: 'announcement', targetId: a.id }} onAdded={ann.refetch} />}
          </Card>
        ))
      )}

      <SectionHeader
        title="Syllabus"
        action={staff ? <Button small variant="ghost" icon="add" title="Add" onPress={() => compose('syllabus', classId)} /> : undefined}
      />
      {!syl.data ? (
        <Loading />
      ) : syl.data.items.length === 0 ? (
        <Text style={font.small}>{staff ? 'Add the first week or unit of your syllabus.' : 'The syllabus has not been published yet.'}</Text>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {syl.data.items.map((item, i) => {
            const expanded = open === item.id;
            return (
              <View key={item.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <Pressable onPress={() => setOpen(expanded ? null : item.id)} style={[ui.row, { padding: space.lg }]}>
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: item.published ? colors.primarySoft : colors.surfaceAlt,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: space.md,
                    }}
                  >
                    <Text style={{ fontWeight: '700', color: item.published ? colors.primary : colors.muted, fontSize: 13 }}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { fontWeight: '600' }]}>{item.title}</Text>
                    <View style={[ui.row, { gap: space.sm, marginTop: 2 }]}>
                      {item.dueOn && <Text style={font.small}>{formatDate(item.dueOn)}</Text>}
                      {!item.published && <Pill text="Draft" />}
                    </View>
                  </View>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
                </Pressable>
                {expanded && (
                  <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, paddingLeft: 56 }}>
                    <Text style={font.body}>{item.body || (item.attachments?.length ? '' : 'No details yet.')}</Text>
                    <AttachmentList items={item.attachments ?? []} canEdit={staff} onChanged={syl.refetch} />
                    {staff && <AttachmentAdder target={{ targetKind: 'syllabus_item', targetId: item.id }} onAdded={syl.refetch} />}
                    {staff && (
                      <View style={{ marginTop: space.md, alignSelf: 'flex-start' }}>
                        <Button
                          small
                          variant="secondary"
                          icon={item.published ? 'eye-off-outline' : 'eye-outline'}
                          title={item.published ? 'Unpublish' : 'Publish'}
                          onPress={() => publish(item)}
                        />
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}

/** A small "Attach" link on an announcement that opens the file/link controls. Staff only. */
function AttachHere({ target, onAdded }: { target: { targetKind: 'announcement'; targetId: string }; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6} style={[ui.row, { marginTop: space.sm, alignSelf: 'flex-start' }]}>
        <Ionicons name="attach-outline" size={15} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13, marginLeft: 4 }}>Attach</Text>
      </Pressable>
    );
  }
  return <AttachmentAdder target={target} onAdded={onAdded} />;
}

function QA({ classId, participant }: { classId: string; participant: boolean }) {
  const [filter, setFilter] = useState<'all' | 'unanswered' | 'mine'>('all');
  const { data } = useFetch<{ questions: QuestionSummary[] }>(`/classes/${classId}/questions?filter=${filter}`);
  return (
    <View>
      <View style={[ui.row, { justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.md }]}>
        <View style={[ui.row, { gap: space.xs }]}>
          {(['all', 'unanswered', 'mine'] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: 6,
                borderRadius: radius.pill,
                backgroundColor: filter === f ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: filter === f ? colors.primary : colors.border,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: filter === f ? '#fff' : colors.muted }}>
                {f === 'all' ? 'All' : f === 'unanswered' ? 'Unanswered' : 'Mine'}
              </Text>
            </Pressable>
          ))}
        </View>
        {participant && <Button small icon="add" title="Ask" onPress={() => compose('question', classId)} />}
      </View>
      {!data ? (
        <Loading />
      ) : data.questions.length === 0 ? (
        <Empty icon="help-circle-outline" title="No questions here" body={participant ? 'Ask anything about the class. Your teacher and classmates can answer.' : undefined} />
      ) : (
        data.questions.map((q) => (
          <Card key={q.id} onPress={() => router.push(`/question/${q.id}`)}>
            <View style={ui.row}>
              <View style={{ alignItems: 'center', width: 44, marginRight: space.md }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: q.score > 0 ? colors.primary : colors.muted }}>{q.score}</Text>
                <Text style={[font.small, { fontSize: 11 }]}>votes</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[font.body, { fontWeight: '600' }]}>{q.title}</Text>
                <View style={[ui.row, { gap: space.sm, marginTop: 6, flexWrap: 'wrap' }]}>
                  {q.resolved ? (
                    <Pill text="Answered" tone="success" icon="checkmark-circle" />
                  ) : (
                    <Pill text={`${q.answerCount} answer${q.answerCount === 1 ? '' : 's'}`} />
                  )}
                  <Text style={[font.small, { fontSize: 12 }]}>
                    {q.author.displayName} · {timeAgo(q.createdAt)}
                  </Text>
                </View>
              </View>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

function Discussions({ classId, participant }: { classId: string; participant: boolean }) {
  const { data } = useFetch<{ topics: TopicSummary[] }>(`/classes/${classId}/topics`);
  return (
    <View>
      <View style={[ui.row, { justifyContent: 'flex-end', marginTop: space.lg, marginBottom: space.md }]}>
        {participant && <Button small icon="add" title="Start a discussion" onPress={() => compose('topic', classId)} />}
      </View>
      {!data ? (
        <Loading />
      ) : data.topics.length === 0 ? (
        <Empty icon="chatbox-ellipses-outline" title="No discussions yet" body="Start a thread to reflect on a lesson or share resources." />
      ) : (
        data.topics.map((t) => (
          <Card key={t.id} onPress={() => router.push(`/topic/${t.id}`)}>
            <View style={[ui.row, { gap: space.sm, marginBottom: 4 }]}>
              {t.pinned && <Pill text="Pinned" tone="accent" icon="pin" />}
              {t.locked && <Pill text="Locked" icon="lock-closed" />}
            </View>
            <Text style={[font.body, { fontWeight: '600' }]}>{t.title}</Text>
            {!!t.excerpt && (
              <Text style={[font.small, { marginTop: 2 }]} numberOfLines={2}>
                {t.excerpt}
              </Text>
            )}
            <View style={[ui.row, { marginTop: space.sm, gap: space.lg }]}>
              <Text style={[font.small, { fontSize: 12 }]}>{t.author.displayName}</Text>
              <View style={ui.row}>
                <Ionicons name="chatbubble-outline" size={13} color={colors.muted} />
                <Text style={[font.small, { fontSize: 12, marginLeft: 4 }]}>{t.replyCount}</Text>
              </View>
              <Text style={[font.small, { fontSize: 12 }]}>active {timeAgo(t.lastActivityAt)}</Text>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}
