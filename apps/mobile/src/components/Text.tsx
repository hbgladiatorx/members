/**
 * Text in the brand font. Open Sans is loaded as one family per face (iOS and Android don't pick a
 * bold or italic face from a custom family on their own), so this swaps `fontWeight`/`fontStyle`
 * for the matching face. Use it instead of React Native's Text everywhere in the app.
 *
 * Nested Text inherits its parent's face (e.g. a link inside a quote stays italic, bold inside
 * italic becomes bold italic), which is why the current face is passed down through context.
 */
import { createContext, useContext } from 'react';
import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';
import { fonts } from '../lib/theme';

type Weight = 'regular' | 'semibold' | 'bold';
interface Face {
  weight: Weight;
  italic: boolean;
}
const FaceContext = createContext<Face | null>(null);

function weightOf(w: TextStyle['fontWeight']): Weight {
  switch (String(w ?? '400')) {
    case '500':
    case '600':
      return 'semibold';
    case '700':
    case '800':
    case '900':
    case 'bold':
      return 'bold';
    default:
      return 'regular';
  }
}

function familyFor(face: Face): string {
  if (face.italic) return face.weight === 'regular' ? fonts.italic : fonts.boldItalic;
  return face.weight === 'regular' ? fonts.regular : face.weight === 'semibold' ? fonts.semibold : fonts.bold;
}

/** The Open Sans face for a font weight (upright). */
export function fontFor(weight: TextStyle['fontWeight']): string {
  return familyFor({ weight: weightOf(weight), italic: false });
}

export function Text({ style, children, ...props }: TextProps) {
  const parent = useContext(FaceContext);
  const flat = StyleSheet.flatten(style) ?? {};
  // An explicit font (e.g. monospace for code) is used as is.
  if (flat.fontFamily) {
    return (
      <RNText {...props} style={style}>
        {children}
      </RNText>
    );
  }
  const face: Face = {
    weight: flat.fontWeight != null ? weightOf(flat.fontWeight) : (parent?.weight ?? 'regular'),
    italic: flat.fontStyle != null ? flat.fontStyle === 'italic' : (parent?.italic ?? false),
  };
  // Nested text that doesn't change the face just inherits it.
  const unchanged = parent && parent.weight === face.weight && parent.italic === face.italic;
  const styled = unchanged
    ? style
    : // The face carries weight and slant, so reset them (otherwise some platforms double them up).
      [style, { fontFamily: familyFor(face), fontWeight: 'normal' as const, fontStyle: 'normal' as const }];
  return (
    <FaceContext.Provider value={face}>
      <RNText {...props} style={styled}>
        {children}
      </RNText>
    </FaceContext.Provider>
  );
}
