/**
 * The rich-text toolbar for any writing box: bold, italic, strikethrough, heading, bullet and
 * numbered lists, quote, code and link. It edits the text as Markdown (lib/markdown.ts), wrapping
 * the selection or, with nothing selected, inserting the marks at the cursor.
 *
 * Use with `useRichInput(value, setValue)`, which tracks the selection of the TextInput.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { colors, radius, space } from '../lib/theme';
import { Text } from './Text';

type Sel = { start: number; end: number };
export type FormatKind = 'bold' | 'italic' | 'strike' | 'heading' | 'bullet' | 'numbered' | 'quote' | 'code' | 'link';

/** Apply a format to `text` at `sel`; returns the new text and where the cursor/selection goes. */
export function applyFormat(text: string, sel: Sel, kind: FormatKind): { text: string; sel: Sel } {
  const { start, end } = sel;
  const selected = text.slice(start, end);
  const wrap = (before: string, after: string, placeholder: string) => {
    const inner = selected || placeholder;
    const next = text.slice(0, start) + before + inner + after + text.slice(end);
    return { text: next, sel: { start: start + before.length, end: start + before.length + inner.length } };
  };
  // Line formats act on every line the selection touches.
  const lines = (prefix: (i: number) => string) => {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = text.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    const block = text.slice(lineStart, lineEnd);
    const changed = block
      .split('\n')
      .map((l, i) => prefix(i) + l.replace(/^(\s*([-*•]|\d+[.)]|>|#{1,3})\s+)/, ''))
      .join('\n');
    const next = text.slice(0, lineStart) + changed + text.slice(lineEnd);
    return { text: next, sel: { start: lineStart + changed.length, end: lineStart + changed.length } };
  };
  switch (kind) {
    case 'bold':
      return wrap('**', '**', 'bold text');
    case 'italic':
      return wrap('_', '_', 'italic text');
    case 'strike':
      return wrap('~~', '~~', 'crossed out');
    case 'code':
      return selected.includes('\n') ? wrap('```\n', '\n```', '') : wrap('`', '`', 'code');
    case 'link': {
      const label = selected || 'link text';
      const before = text.slice(0, start) + '[' + label + '](';
      const next = before + 'https://' + ')' + text.slice(end);
      // Select "https://" so typing replaces it with the address.
      return { text: next, sel: { start: before.length, end: before.length + 'https://'.length } };
    }
    case 'heading':
      return lines(() => '## ');
    case 'bullet':
      return lines(() => '- ');
    case 'numbered':
      return lines((i) => `${i + 1}. `);
    case 'quote':
      return lines(() => '> ');
  }
}

/**
 * Selection tracking for a TextInput that uses the FormatBar. Also `insertBlock` (put text on a line
 * of its own at the cursor, e.g. an attachment placed in the text) and `removeText`.
 */
export function useRichInput(value: string, setValue: (v: string) => void) {
  const sel = useRef<Sel>({ start: value.length, end: value.length });
  // The text the cursor position was last reported for. If the text has changed since without a
  // new position (e.g. filled in programmatically), the cursor is taken to be at the end.
  const selFor = useRef(value);
  // The latest text, for inserts that land after an await (a file picker) rather than on a render.
  const latest = useRef(value);
  latest.current = value;
  const [selection, setSelection] = useState<Sel | undefined>(undefined);
  // On the web the text box's own caret is read directly (browsers don't report a plain caret move).
  const ref = useRef<any>(null);
  const onSelectionChange = useCallback((e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    sel.current = e.nativeEvent.selection;
    selFor.current = (e.nativeEvent as { text?: string }).text ?? latest.current;
  }, []);
  const update = useCallback(
    (text: string, cursor: Sel) => {
      latest.current = text;
      setValue(text);
      sel.current = cursor;
      selFor.current = text;
      // Place the cursor once, then hand it back to the input so typing isn't pulled back to it.
      setSelection(cursor);
      setTimeout(() => setSelection(undefined), 0);
    },
    [setValue],
  );
  const cursorIn = (text: string): Sel => {
    const node = ref.current;
    if (Platform.OS === 'web' && node && typeof node.selectionStart === 'number' && node.value === text) {
      return { start: node.selectionStart, end: node.selectionEnd };
    }
    return selFor.current === text && sel.current.end <= text.length ? sel.current : { start: text.length, end: text.length };
  };
  const format = useCallback(
    (kind: FormatKind) => {
      const r = applyFormat(latest.current, cursorIn(latest.current), kind);
      update(r.text, r.sel);
    },
    [update],
  );
  const insertBlock = useCallback(
    (snippet: string) => {
      const text = latest.current;
      const s = cursorIn(text);
      const before = text.slice(0, s.start);
      const after = text.slice(s.end);
      const head = before + (before && !before.endsWith('\n') ? '\n' : '') + snippet + (after.startsWith('\n') ? '' : '\n');
      update(head + after, { start: head.length, end: head.length });
    },
    [update],
  );
  const removeText = useCallback(
    (snippet: string) => {
      const text = latest.current;
      const at = text.indexOf(snippet);
      if (at < 0) return;
      const end = at + snippet.length + (text[at + snippet.length] === '\n' ? 1 : 0);
      update(text.slice(0, at) + text.slice(end), { start: at, end: at });
    },
    [update],
  );
  return { inputProps: { ref, onSelectionChange, selection }, format, insertBlock, removeText };
}

const BUTTONS: { kind: FormatKind; label: string; icon?: React.ComponentProps<typeof Ionicons>['name']; text?: string; style?: object }[] = [
  { kind: 'bold', label: 'Bold', text: 'B', style: { fontWeight: '700' } },
  { kind: 'italic', label: 'Italic', text: 'I', style: { fontStyle: 'italic' } },
  { kind: 'strike', label: 'Strikethrough', text: 'S', style: { textDecorationLine: 'line-through' } },
  { kind: 'heading', label: 'Heading', text: 'H', style: { fontWeight: '700' } },
  { kind: 'bullet', label: 'Bulleted list', icon: 'list-outline' },
  { kind: 'numbered', label: 'Numbered list', text: '1.', style: { fontWeight: '600' } },
  { kind: 'quote', label: 'Quote', icon: 'chatbox-ellipses-outline' },
  { kind: 'code', label: 'Code', icon: 'code-slash-outline' },
  { kind: 'link', label: 'Link', icon: 'link-outline' },
];

export function FormatBar({ onFormat }: { onFormat: (kind: FormatKind) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      accessibilityRole="toolbar"
      accessibilityLabel="Formatting"
      contentContainerStyle={{ gap: space.xs, paddingVertical: space.xs }}
    >
      {BUTTONS.map((b) => (
        <Pressable
          key={b.kind}
          accessibilityRole="button"
          accessibilityLabel={b.label}
          onPress={() => onFormat(b.kind)}
          // Keep focus in the text box on the web so the selection survives the tap.
          {...({ onMouseDown: (e: any) => e.preventDefault() } as object)}
          style={({ pressed }) => ({
            minWidth: 34,
            height: 32,
            paddingHorizontal: 8,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? colors.primarySoft : colors.surfaceAlt,
          })}
        >
          {b.icon ? (
            <Ionicons name={b.icon} size={17} color={colors.text} />
          ) : (
            <Text style={[{ fontSize: 15, color: colors.text }, b.style]}>{b.text}</Text>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}
