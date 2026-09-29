/**
 * Draws rich text (the Markdown subset in lib/markdown.ts) with the app's own components.
 * No HTML is rendered, and links open only for http(s) and mailto.
 */
import { Linking, Platform, View, type TextStyle } from 'react-native';
import { parseMarkdown, type Inline } from '../lib/markdown';
import { colors, radius, space } from '../lib/theme';
import { Text } from './Text';

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
        }
      })}
    </View>
  );
}
