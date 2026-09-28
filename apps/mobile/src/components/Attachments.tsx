/**
 * Files and links on announcements and syllabus items.
 * - AttachmentList: shows them; tap to open (files through a short-lived signed link).
 * - AttachmentAdder: "Add file" / "Add link" for teachers and assistants, either straight onto an
 *   existing posting or, in the compose screen, queued until the posting is created.
 */
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { api } from '../lib/api';
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

export type PendingAttachment =
  | { kind: 'file'; key: string; name: string; size?: number; asset: DocumentPicker.DocumentPickerAsset }
  | { kind: 'link'; key: string; url: string; title: string };

function iconFor(a: { kind: string; contentType?: string | null; name?: string }): React.ComponentProps<typeof Ionicons>['name'] {
  if (a.kind === 'link') return 'link-outline';
  const t = a.contentType ?? '';
  if (t === 'application/pdf' || a.name?.toLowerCase().endsWith('.pdf')) return 'document-text-outline';
  if (t.startsWith('image/')) return 'image-outline';
  if (t.includes('presentation') || t.includes('powerpoint')) return 'easel-outline';
  if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return 'grid-outline';
  return 'document-outline';
}

const sizeLabel = (bytes?: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Open an attachment. On the web the tab is opened during the tap, or browsers block it. */
async function openAttachment(a: Attachment) {
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

export function AttachmentList({ items, canEdit, onChanged }: { items: Attachment[]; canEdit?: boolean; onChanged?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <View style={{ marginTop: space.md, gap: space.xs }}>
      {items.map((a) => (
        <View key={a.id} style={[ui.row, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 10 }]}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${a.title}`}
            onPress={() => openAttachment(a).catch((e) => setError(e.message))}
            style={[ui.row, { flex: 1 }]}
          >
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
          {canEdit && (
            <Pressable
              accessibilityLabel={`Remove ${a.title}`}
              hitSlop={8}
              onPress={() =>
                api
                  .del(`/attachments/${a.id}`)
                  .then(() => onChanged?.())
                  .catch((e) => setError(e.message))
              }
              style={{ marginLeft: space.sm }}
            >
              <Ionicons name="close-circle-outline" size={20} color={colors.muted} />
            </Pressable>
          )}
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** Upload one queued attachment to a posting that now exists. */
export async function sendAttachment(target: AttachmentTarget, p: PendingAttachment) {
  if (p.kind === 'link') {
    await api.post('/attachments/link', { ...target, url: p.url, title: p.title || undefined });
  } else {
    await api.uploadFile(`/attachments/file?targetKind=${target.targetKind}&targetId=${target.targetId}`, {
      uri: p.asset.uri,
      mimeType: p.asset.mimeType,
      fileName: p.asset.name,
      file: p.asset.file,
    });
  }
}

/**
 * "Add file" / "Add link". With `target`, each one is saved straight away; without it (compose),
 * they're handed to `onQueued` to send once the posting exists.
 */
export function AttachmentAdder({
  target,
  onAdded,
  onQueued,
}: {
  target?: AttachmentTarget;
  onAdded?: () => void;
  onQueued?: (p: PendingAttachment) => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (p: PendingAttachment) => {
    if (!target) return onQueued?.(p);
    setBusy(true);
    try {
      await sendAttachment(target, p);
      onAdded?.();
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, multiple: false, copyToCacheDirectory: true });
      const asset = res.canceled ? null : res.assets[0];
      if (!asset) return;
      if (asset.size && asset.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`Files must be ${MAX_FILE_MB} MB or smaller.`);
        return;
      }
      await add({ kind: 'file', key: `${Date.now()}-${asset.name}`, name: asset.name, size: asset.size, asset });
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

  return (
    <View style={{ marginTop: space.md }}>
      <View style={[ui.row, { gap: space.sm, flexWrap: 'wrap' }]}>
        <Button small variant="secondary" icon="attach-outline" title="Add file" onPress={pickFile} loading={busy} />
        <Button small variant="secondary" icon="link-outline" title="Add link" onPress={() => setLinkOpen((o) => !o)} />
      </View>
      {linkOpen && (
        <View style={{ marginTop: space.md }}>
          <Input
            label="Link"
            value={url}
            onChangeText={setUrl}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
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

/** Attachments queued in the compose screen, before the posting exists. */
export function PendingList({ items, onRemove }: { items: PendingAttachment[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: space.md, gap: space.xs }}>
      {items.map((p) => (
        <View key={p.key} style={[ui.row, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 10 }]}>
          <Ionicons name={iconFor(p.kind === 'file' ? { kind: 'file', name: p.name, contentType: p.asset.mimeType } : { kind: 'link' })} size={18} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <Text style={{ fontWeight: '600', fontSize: 14, color: colors.text }} numberOfLines={1}>
              {p.kind === 'file' ? p.name : p.title || p.url}
            </Text>
            <Text style={[font.small, { fontSize: 12 }]} numberOfLines={1}>
              {p.kind === 'file' ? sizeLabel(p.size) : p.url}
            </Text>
          </View>
          <Pressable accessibilityLabel={`Remove ${p.kind === 'file' ? p.name : p.url}`} hitSlop={8} onPress={() => onRemove(p.key)}>
            <Ionicons name="close-circle-outline" size={20} color={colors.muted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}
