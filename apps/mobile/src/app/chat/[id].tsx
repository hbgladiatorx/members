import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Text } from '../../components/Text';
import { Avatar, ErrorText, Loading } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket, useSocketEvent } from '../../lib/socket';
import { colors, font, fonts, radius, space } from '../../lib/theme';
import type { Message } from '../../lib/types';
import { formatStamp } from '../../lib/useFetch';
import { DraftPreview, PostBody } from '../../components/RichText';
import { FormatBar, useRichInput } from '../../components/FormatBar';
import { AttachmentAdder, PendingList, pendingTitle, placeAttachments, sendAll, withLabel, type PendingAttachment } from '../../components/Attachments';

export default function ChatScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { user } = useAuth();
  const socket = useSocket();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [canPost, setCanPost] = useState(true);
  const [showFormat, setShowFormat] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rich = useRichInput(draft, setDraft);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const markRead = useCallback(
    (seq: number) => {
      if (socket?.connected) socket.emit('read', { channelId: id, seq });
      else api.post(`/channels/${id}/read`, { seq }).catch(() => {});
    },
    [socket, id],
  );

  // Initial page (newest first; the list is inverted so newest sits at the bottom).
  useEffect(() => {
    api
      .get<{ messages: Message[]; hasMore: boolean; canPost: boolean }>(`/channels/${id}/messages?limit=40`)
      .then((r) => {
        setMessages(r.messages);
        setHasMore(r.hasMore);
        setCanPost(r.canPost);
        if (r.messages[0]) markRead(r.messages[0].seq);
      })
      .catch((e) => setError(e.message));
  }, [id, markRead]);

  const loadOlder = async () => {
    if (!hasMore || !messages?.length) return;
    const oldest = messages[messages.length - 1]!.seq;
    const r = await api.get<{ messages: Message[]; hasMore: boolean }>(`/channels/${id}/messages?limit=40&before=${oldest}`);
    setMessages((prev) => [...(prev ?? []), ...r.messages]);
    setHasMore(r.hasMore);
  };

  useSocketEvent<Message>(
    'message:new',
    useCallback(
      (m) => {
        if (m.channelId !== id) return;
        setMessages((prev) => (prev?.some((x) => x.id === m.id) ? prev : [m, ...(prev ?? [])]));
        setTyping(false);
        markRead(m.seq);
      },
      [id, markRead],
    ),
  );
  useSocketEvent<Message>(
    'message:updated',
    useCallback((m) => m.channelId === id && setMessages((prev) => prev?.map((x) => (x.id === m.id ? m : x)) ?? prev), [id]),
  );
  useSocketEvent<{ id: string; channelId: string }>(
    'message:deleted',
    useCallback(
      (d) =>
        d.channelId === id &&
        setMessages((prev) => prev?.map((x) => (x.id === d.id ? { ...x, deleted: true, body: '' } : x)) ?? prev),
      [id],
    ),
  );
  useSocketEvent<{ channelId: string; userId: string }>(
    'typing',
    useCallback(
      (t) => {
        if (t.channelId !== id) return;
        setTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(false), 3000);
      },
      [id],
    ),
  );

  const onChange = (text: string) => {
    setDraft(text);
    const now = Date.now();
    if (socket?.connected && text && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      socket.emit('typing', { channelId: id });
    }
  };

  const send = async () => {
    // Attachments can go on their own; the message then names them.
    const body = placeAttachments(draft, pending).trim() || (pending.length ? `📎 ${pending.map(pendingTitle).join(', ')}` : '');
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      let msg: Message;
      if (socket?.connected) {
        const res: any = await new Promise((resolve) => socket.timeout(8000).emit('message:send', { channelId: id, body }, (err: any, r: any) => resolve(err ? { ok: false, error: { message: 'Timed out, try again' } } : r)));
        if (!res.ok) throw new Error(res.error.message);
        msg = res.data;
      } else {
        msg = (await api.post<{ message: Message }>(`/channels/${id}/messages`, { body })).message;
      }
      setMessages((prev) => (prev?.some((x) => x.id === msg.id) ? prev : [msg, ...(prev ?? [])]));
      setDraft('');
      if (pending.length) {
        // Each attachment updates the message for everyone (message:updated).
        const problems = await sendAll({ targetKind: 'message', targetId: msg.id }, pending);
        setPending([]);
        setShowAttach(false);
        if (problems.length) setError(`Sent, but some attachments couldn’t be added: ${problems.join('; ')}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (messageId: string) => {
    setSelected(null);
    await api.del(`/messages/${messageId}`).catch((e) => setError(e.message));
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ title: name ?? 'Chat' }} />
      {!messages ? (
        error ? <View style={{ padding: space.lg }}><ErrorText>{error}</ErrorText></View> : <Loading />
      ) : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ padding: space.md, maxWidth: 760, width: '100%', alignSelf: 'center' }}
          ListEmptyComponent={
            <View style={{ transform: [{ scaleY: -1 }], alignItems: 'center', padding: space.xxl }}>
              <Text style={font.small}>No messages yet. Say salaam 👋</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const mine = item.author.id === user?.id;
            const older = messages[index + 1];
            const grouped = older && older.author.id === item.author.id && !older.deleted &&
              new Date(item.createdAt).getTime() - new Date(older.createdAt).getTime() < 5 * 60_000;
            return (
              <Bubble
                message={item}
                mine={mine}
                grouped={!!grouped}
                selected={selected === item.id}
                onLongPress={() => mine && !item.deleted && setSelected(selected === item.id ? null : item.id)}
                onDelete={() => remove(item.id)}
              />
            );
          }}
        />
      )}
      <View style={{ height: 18, paddingHorizontal: space.lg }}>
        {typing && <Text style={[font.small, { fontSize: 12, fontStyle: 'italic' }]}>Someone is typing…</Text>}
      </View>
      {error && messages && <View style={{ paddingHorizontal: space.lg }}><ErrorText>{error}</ErrorText></View>}
      {!canPost ? (
        <View
          style={[
            { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: space.md },
            { paddingBottom: space.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
          ]}
        >
          <Ionicons name="eye-outline" size={15} color={colors.muted} />
          <Text style={[font.small, { marginLeft: 6 }]}>You’re observing. You can read this chat but not post.</Text>
        </View>
      ) : (
        <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
        {showAttach && (
          <View style={{ paddingHorizontal: space.sm, paddingTop: space.sm }}>
            <AttachmentAdder
              compact
              onQueued={(queued) => {
                // Placed in the message where the cursor is, as a stand-in like "[📷 board.png]".
                const p = withLabel(queued, pending);
                rich.insertBlock(p.label!);
                setPending((l) => [...l, p]);
              }}
            />
            <PendingList
              items={pending}
              onRemove={(key) => {
                const p = pending.find((x) => x.key === key);
                if (p?.label) rich.removeText(p.label);
                setPending((l) => l.filter((x) => x.key !== key));
              }}
            />
          </View>
        )}
        {pending.length > 0 && (
          // What the message will look like, photos and links where they were put.
          <ScrollView style={{ maxHeight: 260, paddingHorizontal: space.sm }}>
            <DraftPreview text={draft} pending={pending} />
          </ScrollView>
        )}
        {showFormat && (
          <View style={{ paddingHorizontal: space.sm, paddingTop: space.xs }}>
            <FormatBar onFormat={rich.format} />
          </View>
        )}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            padding: space.sm,
            paddingBottom: space.sm, // the bottom bar below handles the safe area
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showAttach ? 'Hide attachments' : 'Attach a photo, file or link'}
            accessibilityState={{ expanded: showAttach }}
            onPress={() => setShowAttach((v) => !v)}
            style={{
              width: 38,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: showAttach ? colors.primarySoft : 'transparent',
            }}
          >
            <Ionicons name={showAttach ? 'close' : 'add'} size={24} color={showAttach || pending.length ? colors.primary : colors.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showFormat ? 'Hide formatting' : 'Show formatting'}
            accessibilityState={{ expanded: showFormat }}
            onPress={() => setShowFormat((v) => !v)}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              marginRight: space.xs,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: showFormat ? colors.primarySoft : 'transparent',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: showFormat ? colors.primary : colors.muted }}>Aa</Text>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={onChange}
            {...rich.inputProps}
            placeholder="Message"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={4000}
            onKeyPress={(e: any) => {
              // Enter sends on web; Shift+Enter adds a new line.
              if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 42,
              backgroundColor: colors.bg,
              borderRadius: 21,
              paddingHorizontal: space.lg,
              paddingTop: 11,
              paddingBottom: 11,
              fontSize: 16,
              lineHeight: 20,
              fontFamily: fonts.regular,
              color: colors.text,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={send}
            disabled={(!draft.trim() && !pending.length) || sending}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              marginLeft: space.sm,
              backgroundColor: draft.trim() || pending.length ? colors.primary : colors.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="arrow-up" size={20} color={draft.trim() || pending.length ? colors.onPrimary : colors.muted} />
          </Pressable>
        </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message: m,
  mine,
  grouped,
  selected,
  onLongPress,
  onDelete,
}: {
  message: Message;
  mine: boolean;
  grouped: boolean;
  selected: boolean;
  onLongPress: () => void;
  onDelete: () => void;
}) {
  const time = formatStamp(m.createdAt);
  return (
    <View style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: grouped ? 2 : space.md }}>
      {!mine && (
        <Pressable style={{ width: 32, marginRight: 6 }} disabled={grouped} onPress={() => router.push(`/user/${m.author.id}`)} accessibilityLabel={`${m.author.displayName}'s profile`}>
          {!grouped && <Avatar name={m.author.displayName} url={m.author.avatarUrl} size={30} />}
        </Pressable>
      )}
      <View style={{ maxWidth: '78%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
        {!mine && !grouped && <Text style={[font.small, { fontSize: 12, fontWeight: '600', marginBottom: 2, marginLeft: 4 }]}>{m.author.displayName}</Text>}
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={300}
          style={{
            backgroundColor: m.deleted ? 'transparent' : mine ? colors.bubbleMine : colors.bubbleTheirs,
            borderWidth: m.deleted || !mine ? 1 : 0,
            borderColor: colors.border,
            borderRadius: radius.lg,
            borderBottomRightRadius: mine && !grouped ? 4 : radius.lg,
            borderBottomLeftRadius: !mine && !grouped ? 4 : radius.lg,
            paddingHorizontal: space.md,
            paddingVertical: 8,
          }}
        >
          {m.deleted ? (
            <Text style={[font.small, { fontStyle: 'italic' }]}>Message deleted</Text>
          ) : (
            <>
              <PostBody
                text={m.body}
                attachments={m.attachments}
                inverted={mine}
                style={{ color: mine ? colors.onPrimary : colors.text }}
                canRemove={mine ? () => true : undefined}
              />
            </>
          )}
          <Text style={{ fontSize: 10, marginTop: 2, alignSelf: 'flex-end', color: mine && !m.deleted ? 'rgba(255,255,255,0.7)' : colors.muted }}>
            {m.editedAt ? 'edited · ' : ''}
            {time}
          </Text>
        </Pressable>
        {selected && (
          <Pressable onPress={onDelete} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, padding: 4 }}>
            <Ionicons name="trash-outline" size={14} color={colors.danger} />
            <Text style={{ color: colors.danger, fontSize: 13, marginLeft: 4, fontWeight: '600' }}>Delete</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
