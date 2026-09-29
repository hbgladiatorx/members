/**
 * Files, images and links on any posting: chat messages and DMs, questions and answers, discussion
 * topics and replies, announcements and syllabus items.
 * - AttachmentList: shows them (images as pictures); tap to open (files through a short-lived signed link).
 * - AttachmentAdder: "Photo" / "File" / "Link", either saved straight onto an existing posting or, while
 *   writing, queued until the posting exists (then `sendAttachment`).
 * - PendingList: what's queued.
 */
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Linking, Platform, Pressable, View } from 'react-native';
import { api } from '../lib/api';
import { attachmentToken, newAttachmentRef } from '../lib/markdown';
import { colors, font, radius, space } from '../lib/theme';
import type { Attachment, AttachmentTarget } from '../lib/types';
import { Text } from './Text';
import { Button, ErrorText, Input, styles as ui } from './ui';

/** What the server accepts (it checks the content too). */
const PICKER_TYPES = [
  'application/pdf',
  'image/*',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/markdown',
];
export const MAX_FILE_MB = 25;

/** A picked file or photo, ready to upload. */
interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  file?: File;
}

/**
 * `ref`: set when the attachment is placed in the text (lib/markdown.ts `attachmentToken`).
 * `label`: what stands for it in the writing box while writing, e.g. "[📷 board.png]"; it's swapped
 * for the real placement by `placeAttachments` when the posting is sent.
 */
export type PendingAttachment =
  | { kind: 'file'; key: string; ref?: string; label?: string; file: PickedFile }
  | { kind: 'link'; key: string; ref?: string; label?: string; url: string; title: string };

/** The name a queued attachment goes by (and the title it's placed in the text with). */
export const pendingTitle = (p: PendingAttachment) => (p.kind === 'file' ? p.file.name : p.title || p.url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0]!);

const pendingIsImage = (p: PendingAttachment) =>
  p.kind === 'file' && ((p.file.mimeType ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(p.file.name));

/** Give a newly queued attachment its stand-in for the writing box, unique among `others`. */
export function withLabel(p: PendingAttachment, others: PendingAttachment[]): PendingAttachment {
  const icon = p.kind === 'link' ? '🔗' : pendingIsImage(p) ? '📷' : '📎';
  const name = pendingTitle(p).replace(/[[\]]/g, '');
  let label = `[${icon} ${name}]`;
  for (let n = 2; others.some((o) => o.label === label); n++) label = `[${icon} ${name} (${n})]`;
  return { ...p, label };
}

/** The text to send: each stand-in swapped for the attachment's placement (![title](attachment:ref)). */
export function placeAttachments(text: string, pending: PendingAttachment[]): string {
  let out = text;
  for (const p of pending) if (p.label && p.ref) out = out.replace(p.label, attachmentToken(pendingTitle(p), p.ref));
  return out;
}

/** Queued attachments as attachments, for previewing a posting before it's sent. */
export function previewAttachments(pending: PendingAttachment[]): Attachment[] {
  return pending
    .filter((p) => p.ref)
    .map((p) => ({
      id: p.key,
      ref: p.ref,
      kind: p.kind,
      title: pendingTitle(p),
      url: p.kind === 'link' ? p.url : null,
      contentType: p.kind === 'file' ? (p.file.mimeType ?? null) : null,
      sizeBytes: p.kind === 'file' ? (p.file.size ?? null) : null,
      createdAt: new Date().toISOString(),
      createdBy: '',
      previewUrl: pendingIsImage(p) && p.kind === 'file' ? p.file.uri : undefined,
    }));
}

function iconFor(a: { kind: string; contentType?: string | null; name?: string }): React.ComponentProps<typeof Ionicons>['name'] {
  if (a.kind === 'link') return 'link-outline';
  const t = a.contentType ?? '';
  const n = a.name?.toLowerCase() ?? '';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'document-text-outline';
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/.test(n)) return 'image-outline';
  if (t.includes('presentation') || t.includes('powerpoint')) return 'easel-outline';
  if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return 'grid-outline';
  return 'document-outline';
}

const sizeLabel = (bytes?: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Open an attachment. On the web the tab is opened during the tap, or browsers block it. */
export async function openAttachment(a: Attachment) {
  const tab = Platform.OS === 'web' ? window.open('about:blank', '_blank') : null;
  try {
    const { url } = await api.get<{ url: string }>(`/attachments/${a.id}/open`);
    if (tab) tab.location.href = url;
    else await Linking.openURL(url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** One attachment: an image as a picture, a file or link as a row. Tap to open. */
export function AttachmentView({ a, canRemove, onChanged, preview }: { a: Attachment; canRemove?: boolean; onChanged?: () => void; preview?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  // In a preview (not yet sent) there's nothing on the server to open.
  const open = () => (preview ? undefined : openAttachment(a).catch((e) => setError(e.message)));
  const remove = () =>
    api
      .del(`/attachments/${a.id}`)
      .then(() => onChanged?.())
      .catch((e) => setError(e.message));

  return (
    <View>
      {a.previewUrl ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open picture ${a.title}`} onPress={open}>
            <Image
              source={{ uri: a.previewUrl }}
              accessibilityLabel={a.title}
              resizeMode="cover"
              style={{ width: 220, height: 160, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
            />
          </Pressable>
          {canRemove && (
            <Pressable
              accessibilityLabel={`Remove ${a.title}`}
              onPress={remove}
              hitSlop={8}
              style={{ position: 'absolute', top: 6, right: 6, backgroundColor: colors.surface, borderRadius: 12 }}
            >
              <Ionicons name="close-circle" size={22} color={colors.muted} />
            </Pressable>
          )}
        </View>
      ) : (
        <View style={[ui.row, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 10 }]}>
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${a.title}`} onPress={open} style={[ui.row, { flex: 1 }]}>
            <Ionicons name={iconFor(a)} size={18} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                {a.title}
              </Text>
              <Text style={[font.small, { fontSize: 12 }]} numberOfLines={1}>
                {a.kind === 'link' ? a.url : sizeLabel(a.sizeBytes)}
              </Text>
            </View>
          </Pressable>
          {canRemove && (
            <Pressable accessibilityLabel={`Remove ${a.title}`} hitSlop={8} onPress={remove} style={{ marginLeft: space.sm }}>
              <Ionicons name="close-circle-outline" size={20} color={colors.muted} />
            </Pressable>
          )}
        </View>
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

export function AttachmentList({
  items,
  canRemove,
  onChanged,
}: {
  items: Attachment[];
  /** Who may remove which attachment (uploader or staff); omit for read-only. */
  canRemove?: (a: Attachment) => boolean;
  onChanged?: () => void;
}) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: space.sm, gap: space.xs }}>
      {items.map((a) => (
        <AttachmentView key={a.id} a={a} canRemove={canRemove?.(a)} onChanged={onChanged} />
      ))}
    </View>
  );
}

/** Upload one queued attachment to a posting that now exists. */
export async function sendAttachment(target: AttachmentTarget, p: PendingAttachment) {
  if (p.kind === 'link') {
    await api.post('/attachments/link', { ...target, url: p.url, title: p.title || undefined, ref: p.ref });
  } else {
    const ref = p.ref ? `&ref=${p.ref}` : '';
    await api.uploadFile(`/attachments/file?targetKind=${target.targetKind}&targetId=${target.targetId}${ref}`, {
      uri: p.file.uri,
      mimeType: p.file.mimeType,
      fileName: p.file.name,
      file: p.file.file,
    });
  }
}

/** Send every queued attachment; returns a line per failure (the posting itself is already saved). */
export async function sendAll(target: AttachmentTarget, pending: PendingAttachment[]) {
  const problems: string[] = [];
  for (const p of pending) {
    try {
      await sendAttachment(target, p);
    } catch (e: any) {
      problems.push(`${pendingTitle(p)}: ${e.message}`);
    }
  }
  return problems;
}

/**
 * "Photo" / "File" / "Link". With `target`, each is saved straight away; without it, they go to
 * `onQueued` to send once the posting exists. `compact` shows icon buttons (for the chat composer).
 */
export function AttachmentAdder({
  target,
  onAdded,
  onQueued,
  compact,
}: {
  target?: AttachmentTarget;
  onAdded?: () => void;
  onQueued?: (p: PendingAttachment) => void;
  compact?: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (p: PendingAttachment) => {
    // Queued while writing: it gets a reference so it can be placed in the text.
    if (!target) return onQueued?.({ ...p, ref: newAttachmentRef() });
    setBusy(true);
    try {
      await sendAttachment(target, p);
      onAdded?.();
    } finally {
      setBusy(false);
    }
  };

  const tooBig = (size?: number | null) => {
    if (size && size > MAX_FILE_MB * 1024 * 1024) {
      setError(`Files must be ${MAX_FILE_MB} MB or smaller.`);
      return true;
    }
    return false;
  };

  const pickPhoto = async () => {
    setError(null);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return setError('Photo access is off. Turn it on in Settings to add a picture.');
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      const a = res.canceled ? null : res.assets[0];
      if (!a || tooBig(a.fileSize)) return;
      const name = a.fileName ?? `photo.${(a.mimeType ?? 'image/jpeg').split('/')[1] ?? 'jpg'}`;
      await add({ kind: 'file', key: `${Date.now()}-${name}`, file: { uri: a.uri, name, mimeType: a.mimeType, size: a.fileSize, file: a.file } });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const pickFile = async () => {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, multiple: false, copyToCacheDirectory: true });
      const a = res.canceled ? null : res.assets[0];
      if (!a || tooBig(a.size)) return;
      await add({ kind: 'file', key: `${Date.now()}-${a.name}`, file: { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size, file: a.file } });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const saveLink = async () => {
    setError(null);
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      new URL(u);
    } catch {
      setError('That doesn’t look like a web address.');
      return;
    }
    try {
      await add({ kind: 'link', key: `${Date.now()}-${u}`, url: u, title: title.trim() });
      setUrl('');
      setTitle('');
      setLinkOpen(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const buttons: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }[] = [
    { label: 'Add photo', icon: 'image-outline', onPress: pickPhoto },
    { label: 'Add file', icon: 'attach-outline', onPress: pickFile },
    { label: 'Add link', icon: 'link-outline', onPress: () => setLinkOpen((o) => !o) },
  ];

  return (
    <View style={{ marginTop: compact ? 0 : space.md }}>
      <View style={[ui.row, { gap: space.sm, flexWrap: 'wrap' }]}>
        {buttons.map((b) =>
          compact ? (
            <Pressable
              key={b.label}
              accessibilityRole="button"
              accessibilityLabel={b.label}
              onPress={b.onPress}
              disabled={busy}
              style={({ pressed }) => [
                ui.row,
                { paddingHorizontal: space.md, height: 34, borderRadius: radius.pill, backgroundColor: pressed ? colors.primarySoft : colors.surfaceAlt },
              ]}
            >
              <Ionicons name={b.icon} size={17} color={colors.primary} />
              <Text style={{ marginLeft: 4, fontSize: 13, fontWeight: '600', color: colors.primary }}>{b.label.replace('Add p', 'P').replace('Add f', 'F').replace('Add l', 'L')}</Text>
            </Pressable>
          ) : (
            <Button key={b.label} small variant="secondary" icon={b.icon} title={b.label} onPress={b.onPress} loading={busy && b.label !== 'Add link'} />
          ),
        )}
      </View>
      {linkOpen && (
        <View style={{ marginTop: space.md }}>
          <Input label="Link" value={url} onChangeText={setUrl} placeholder="https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Input label="Title (optional)" value={title} onChangeText={setTitle} placeholder="e.g. Lecture recording" maxLength={200} />
          <View style={[ui.row, { gap: space.sm }]}>
            <Button small title="Add link" onPress={saveLink} disabled={!url.trim()} loading={busy} />
            <Button small variant="ghost" title="Cancel" onPress={() => setLinkOpen(false)} />
          </View>
        </View>
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** Attachments queued while writing, before the posting exists. */
export function PendingList({ items, onRemove }: { items: PendingAttachment[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: space.sm, gap: space.xs }}>
      {items.map((p) => (
        <View key={p.key} style={[ui.row, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 8 }]}>
          <Ionicons
            name={iconFor(p.kind === 'file' ? { kind: 'file', name: p.file.name, contentType: p.file.mimeType } : { kind: 'link' })}
            size={18}
            color={colors.primary}
          />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <Text style={{ fontWeight: '600', fontSize: 14, color: colors.text }} numberOfLines={1}>
              {p.kind === 'file' ? p.file.name : p.title || p.url}
            </Text>
            <Text style={[font.small, { fontSize: 12 }]} numberOfLines={1}>
              {p.kind === 'file' ? sizeLabel(p.file.size) : p.url}
            </Text>
          </View>
          <Pressable accessibilityLabel={`Remove ${p.kind === 'file' ? p.file.name : p.url}`} hitSlop={8} onPress={() => onRemove(p.key)}>
            <Ionicons name="close-circle-outline" size={20} color={colors.muted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}
