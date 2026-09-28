export const colors = {
  bg: '#F6F5F1',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEDE6',
  text: '#1B1F1D',
  muted: '#6B706C',
  border: '#E3E0D7',
  primary: '#0F5C4F',
  primarySoft: '#E3EFEC',
  onPrimary: '#FFFFFF',
  accent: '#B8893B',
  accentSoft: '#F6EBD6',
  danger: '#B42318',
  success: '#1F7A4D',
  bubbleMine: '#0F5C4F',
  bubbleTheirs: '#FFFFFF',
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
