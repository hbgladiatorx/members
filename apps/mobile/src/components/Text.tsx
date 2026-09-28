/**
 * Text in the brand font. Open Sans is loaded as one family per weight (iOS and Android don't
 * pick a bold face from a custom family on their own), so this swaps `fontWeight` for the
 * matching face. Use it instead of React Native's Text everywhere in the app.
 */
import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';
import { fonts } from '../lib/theme';

export function fontFor(weight: TextStyle['fontWeight']): string {
  switch (String(weight ?? '400')) {
    case '500':
    case '600':
      return fonts.semibold;
    case '700':
    case '800':
    case '900':
    case 'bold':
      return fonts.bold;
    default:
      return fonts.regular;
  }
}

/** The style with Open Sans applied, unless it already names a font (e.g. monospace). */
export function withBrandFont(style: TextProps['style']) {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  return [style, { fontFamily: fontFor(flat.fontWeight), fontWeight: 'normal' as const }];
}

export function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={withBrandFont(style)} />;
}
