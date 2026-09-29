/**
 * The Mainstay Foundation brand (Brand Guidelines v2.0, 2021).
 *
 * Primary palette: Blue #226188 (R34 G97 B136), Dark Grey #6D6E71, Light Grey #C7C8CA.
 * Secondary palette: Red #D15046, Beige #DAC6B5, Light Blue #5E90AA.
 * Primary font: Open Sans; the app uses Regular, SemiBold and Bold (plus italics for rich text). The guide's headline face
 * (Go Bold) isn't freely licensed for apps, so headlines use Open Sans Bold.
 * Logos live in assets/ (logo-horizontal, logo-stacked, logo-mark); never stretch, tilt,
 * recolour or outline them, or show the word mark without the icon.
 */
export const brand = {
  blue: '#226188',
  darkGrey: '#6D6E71',
  lightGrey: '#C7C8CA',
  red: '#D15046',
  beige: '#DAC6B5',
  lightBlue: '#5E90AA',
};

export const colors = {
  bg: '#F4F6F8',
  surface: '#FFFFFF',
  surfaceAlt: '#ECEEF0',
  text: '#1C2B36', // blue-black for body text; brand dark grey is for secondary text
  muted: brand.darkGrey,
  border: '#DCDEE0', // Light Grey, lightened for hairlines
  primary: brand.blue,
  primarySoft: '#E3EDF3',
  onPrimary: '#FFFFFF',
  accent: brand.red, // unread badges, pins
  accentSoft: '#F4EDE6', // Beige, lightened: highlighted cards and teacher badges
  accentText: '#6F5543', // text on accentSoft
  danger: '#B8433A', // brand Red, darkened for readable text
  success: '#1F7A4D',
  successSoft: '#DDF1E6',
  successBorder: '#BFE3CF',
  bubbleMine: brand.blue,
  bubbleTheirs: '#FFFFFF',
};

/** Open Sans faces, loaded in app/_layout.tsx. Each weight is its own family on iOS and Android. */
export const fonts = {
  regular: 'OpenSans_400Regular',
  semibold: 'OpenSans_600SemiBold',
  bold: 'OpenSans_700Bold',
  // Italics, for rich text. iOS and Android don't slant a custom font on their own.
  italic: 'OpenSans_400Regular_Italic',
  boldItalic: 'OpenSans_700Bold_Italic',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const font = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  small: { fontSize: 13, color: colors.muted },
  label: { fontSize: 12, fontWeight: '600' as const, color: colors.muted, letterSpacing: 0.4, textTransform: 'uppercase' as const },
};
