/**
 * Draws rich text (the Markdown subset in lib/markdown.ts) with the app's own components.
 * No HTML is rendered, and links open only for http(s) and mailto.
 *
 * `PostBody` is a posting's text with its attachments: those placed in the text are shown where
 * they were put, the rest below it.
 */
import { createContext, useContext } from 'react';
import { Linking, Platform, View, type TextStyle } from 'react-native';
import { parseMarkdown, placedRefs, type Inline } from '../lib/markdown';
import { colors, font, radius, space } from '../lib/theme';
import type { Attachment } from '../lib/types';
import { AttachmentList, AttachmentView, openAttachment, placeAttachments, previewAttachments, type PendingAttachment } from './Attachments';
import { Text } from './Text';

interface Placed {
  byRef: Map<string, Attachment>;
  canRemove?: (a: Attachment) => boolean;
  onChanged?: () => void;
  preview?: boolean;
}
const PlacedContext = createContext<Placed>({ byRef: new Map() });

/** An attachment placed inside a sentence: a small tappable name. */
function InlineAttachment({ refId, title, linkColor }: { refId: string; title: string; linkColor: string }) {
  const { byRef, preview } = useContext(PlacedContext);
  const a = byRef.get(refId);
  if (!a) return <Text style={{ opacity: 0.7 }}>{`📎 ${title}`}</Text>;
  return (
    <Text
      accessibilityRole="link"
      accessibilityLabel={`Open ${a.title}`}
      onPress={preview ? undefined : () => openAttachment(a).catch(() => {})}
      style={{ color: linkColor, fontWeight: '600' }}
    >
      {`📎 ${a.title}`}
    </Text>
  );
}

/** An attachment placed on a line of its own: shown full size (pictures as pictures). */
function BlockAttachment({ refId, title, base }: { refId: string; title: string; base: TextStyle }) {
  const { byRef, canRemove, onChanged, preview } = useContext(PlacedContext);
  const a = byRef.get(refId);
  // Not there (still uploading, or removed): just its name.
  if (!a) return <Text style={[base, { opacity: 0.7, fontStyle: 'italic' }]}>{`📎 ${title}`}</Text>;
  return <AttachmentView a={a} canRemove={canRemove?.(a)} onChanged={onChanged} preview={preview} />;
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function Inlines({ nodes, linkColor, codeBg }: { nodes: Inline[]; linkColor: string; codeBg: string }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return n.text;
          case 'bold':
            return (
              <Text key={i} style={{ fontWeight: '700' }}>
                <Inlines nodes={n.children} linkColor={linkColor} codeBg={codeBg} />
              </Text>
            );
          case 'italic':
            return (
              <Text key={i} style={{ fontStyle: 'italic' }}>
                <Inlines nodes={n.children} linkColor={linkColor} codeBg={codeBg} />
              </Text>
            );
          case 'strike':
            return (
              <Text key={i} style={{ textDecorationLine: 'line-through' }}>
                <Inlines nodes={n.children} linkColor={linkColor} codeBg={codeBg} />
              </Text>
            );
          case 'code':
            return (
              <Text key={i} style={{ fontFamily: MONO, backgroundColor: codeBg, fontSize: 14 }}>
                {n.text}
              </Text>
            );
          case 'att':
            return <InlineAttachment key={i} refId={n.ref} title={n.title} linkColor={linkColor} />;
          case 'link':
            return (
              <Text
                key={i}
                accessibilityRole="link"
                onPress={() => Linking.openURL(n.href).catch(() => {})}
                style={{ color: linkColor, textDecorationLine: 'underline' }}
              >
                <Inlines nodes={n.children} linkColor={linkColor} codeBg={codeBg} />
              </Text>
            );
        }
      })}
    </>
  );
}

/**
 * @param style base text style (size, colour); formatting is layered on top.
 * @param inverted light text on a dark background (your own chat bubbles).
 */
export function RichText({ text, style, inverted }: { text: string; style?: TextStyle; inverted?: boolean }) {
  const blocks = parseMarkdown(text);
  const base: TextStyle = { fontSize: 15, lineHeight: 21, color: colors.text, ...style };
  const linkColor = inverted ? (base.color as string) : colors.primary;
  const codeBg = inverted ? 'rgba(255,255,255,0.18)' : colors.surfaceAlt;
  const rule = inverted ? 'rgba(255,255,255,0.5)' : colors.border;
  const gap = space.sm;

  return (
    <View style={{ gap }}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <Text key={i} style={base}>
                {b.lines.map((line, j) => (
                  <Text key={j}>
                    {j > 0 ? '\n' : ''}
                    <Inlines nodes={line} linkColor={linkColor} codeBg={codeBg} />
                  </Text>
                ))}
              </Text>
            );
          case 'h':
            return (
              <Text key={i} accessibilityRole="header" style={[base, { fontWeight: '700', fontSize: (base.fontSize ?? 15) + (b.level === 1 ? 5 : b.level === 2 ? 3 : 1), lineHeight: undefined }]}>
                <Inlines nodes={b.children} linkColor={linkColor} codeBg={codeBg} />
              </Text>
            );
          case 'ul':
          case 'ol':
            return (
              <View key={i} style={{ gap: 2 }}>
                {b.items.map((item, j) => (
                  <View key={j} style={{ flexDirection: 'row' }}>
                    <Text style={[base, { width: b.t === 'ol' ? 24 : 16 }]}>{b.t === 'ol' ? `${b.start + j}.` : '•'}</Text>
                    <Text style={[base, { flex: 1 }]}>
                      <Inlines nodes={item} linkColor={linkColor} codeBg={codeBg} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: rule, paddingLeft: space.md }}>
                <Text style={[base, { fontStyle: 'italic', opacity: 0.9 }]}>
                  {b.lines.map((line, j) => (
                    <Text key={j}>
                      {j > 0 ? '\n' : ''}
                      <Inlines nodes={line} linkColor={linkColor} codeBg={codeBg} />
                    </Text>
                  ))}
                </Text>
              </View>
            );
          case 'code':
            return (
              <View key={i} style={{ backgroundColor: codeBg, borderRadius: radius.sm, padding: space.sm }}>
                <Text style={[base, { fontFamily: MONO, fontSize: 13, lineHeight: 18 }]}>{b.text}</Text>
              </View>
            );
          case 'att':
            return <BlockAttachment key={i} refId={b.ref} title={b.title} base={base} />;
        }
      })}
    </View>
  );
}

/**
 * A posting's text and attachments. Attachments placed in the text (![title](attachment:<ref>)) are
 * drawn there; any others are listed below.
 */
export function PostBody({
  text,
  attachments = [],
  canRemove,
  onChanged,
  style,
  inverted,
  preview,
}: {
  text: string;
  attachments?: Attachment[];
  canRemove?: (a: Attachment) => boolean;
  onChanged?: () => void;
  style?: TextStyle;
  inverted?: boolean;
  /** Drawing a posting that hasn't been sent yet: nothing opens. */
  preview?: boolean;
}) {
  const placed = text ? placedRefs(text) : new Set<string>();
  const byRef = new Map(attachments.filter((a) => a.ref && placed.has(a.ref)).map((a) => [a.ref!, a]));
  const rest = attachments.filter((a) => !a.ref || !byRef.has(a.ref));
  return (
    <PlacedContext.Provider value={{ byRef, canRemove, onChanged, preview }}>
      {!!text && <RichText text={text} style={style} inverted={inverted} />}
      {!preview && <AttachmentList items={rest} canRemove={canRemove} onChanged={onChanged} />}
    </PlacedContext.Provider>
  );
}

/** How a posting being written will look, with its queued photos, files and links where they were put. */
export function DraftPreview({ text, pending }: { text: string; pending: PendingAttachment[] }) {
  if (!pending.length) return null;
  return (
    <View
      accessibilityLabel="Preview"
      style={{ marginTop: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
    >
      <Text style={[font.label, { marginBottom: space.sm }]}>Preview</Text>
      <PostBody text={placeAttachments(text, pending)} attachments={previewAttachments(pending)} preview />
    </View>
  );
}
