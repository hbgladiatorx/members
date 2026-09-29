/**
 * The rich-text toolbar for any writing box: bold, italic, strikethrough, heading, bullet and
 * numbered lists, quote, code and link. It edits the text as Markdown (lib/markdown.ts), wrapping
 * the selection or, with nothing selected, inserting the marks at the cursor.
 *
 * Use with `useRichInput(value, setValue)`, which tracks the selection of the TextInput.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
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

/** Selection tracking for a TextInput that uses the FormatBar. */
export function useRichInput(value: string, setValue: (v: string) => void) {
  const sel = useRef<Sel>({ start: value.length, end: value.length });
  const [selection, setSelection] = useState<Sel | undefined>(undefined);
  const onSelectionChange = useCallback((e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    sel.current = e.nativeEvent.selection;
    setSelection(undefined); // hand control back to the input once the user moves the cursor
  }, []);
  const format = useCallback(
    (kind: FormatKind) => {
      const s = sel.current.end <= value.length ? sel.current : { start: value.length, end: value.length };
      const r = applyFormat(value, s, kind);
      setValue(r.text);
      sel.current = r.sel;
      setSelection(r.sel);
    },
    [value, setValue],
  );
  return { inputProps: { onSelectionChange, selection }, format };
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
