import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { goToSection } from '../lib/nav';
import { Text } from './Text';
import { colors, font, fonts, radius, space } from '../lib/theme';
import { serverFileUrl } from '../lib/api';
import { ROLE_LABELS, type Role } from '../lib/types';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  small,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  small?: boolean;
  style?: ViewStyle;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={small ? 15 : 18} color={v.fg} style={{ marginRight: 6 }} />}
          <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: v.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const buttonVariants = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.surface, fg: colors.primary, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  danger: { bg: colors.surface, fg: colors.danger, border: colors.border },
};

export function Input({ label, error, style, ...props }: TextInputProps & { label?: string; error?: string | null; ref?: React.Ref<TextInput> }) {
  return (
    <View style={{ marginBottom: space.md }}>
      {label && <Text style={[font.label, { marginBottom: 6 }]}>{label}</Text>}
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        style={[styles.input, props.multiline && { minHeight: 110, textAlignVertical: 'top' }, style]}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceAlt }, style]}>
      {children}
    </Pressable>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    return (
      <Image
        source={{ uri: serverFileUrl(url) }}
        accessibilityLabel={`${name}'s photo`}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceAlt }}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  // Stable pastel color per name
  const hues = ['#DCE8F0', '#E4EEF3', '#F1E8DF', '#E8E9EA', '#F5E1DE', '#D9E6EC'];
  const bg = hues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontWeight: '700', color: colors.text, fontSize: size * 0.38 }}>{initials || '?'}</Text>
    </View>
  );
}

const BADGE_TONES: Record<Role | 'admin', { bg: string; fg: string }> = {
  admin: { bg: colors.primary, fg: colors.onPrimary },
  instructor: { bg: colors.accentSoft, fg: colors.accentText },
  assistant: { bg: colors.primarySoft, fg: colors.primary },
  student: { bg: colors.surfaceAlt, fg: colors.muted },
  observer: { bg: colors.surfaceAlt, fg: colors.muted },
};

/** Role label. Students get none by default, since most people in a class are students. */
/** The Mainstay Foundation logo. Keep its proportions; the brand guide sets minimum sizes. */
const LOGOS = {
  horizontal: { src: require('../../assets/logo-horizontal.png'), ratio: 1200 / 323, min: 84 },
  stacked: { src: require('../../assets/logo-stacked.png'), ratio: 900 / 651, min: 52 },
  mark: { src: require('../../assets/logo-mark.png'), ratio: 1, min: 30 },
};
export function Logo({ variant = 'horizontal', width }: { variant?: keyof typeof LOGOS; width: number }) {
  const l = LOGOS[variant];
  const w = Math.max(width, l.min);
  return <Image source={l.src} accessibilityLabel="The Mainstay Foundation" resizeMode="contain" style={{ width: w, height: w / l.ratio }} />;
}

/** The logo in every screen's header. Tapping it always goes to the front page (Classes). */
export function HeaderLogo() {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Home: The Mainstay Foundation"
      onPress={() => goToSection('/')}
      hitSlop={8}
      style={{ marginHorizontal: 12 }}
    >
      <Logo variant="mark" width={30} />
    </Pressable>
  );
}

export function RoleBadge({ role, showStudent }: { role: Role | 'admin'; showStudent?: boolean }) {
  if (role === 'student' && !showStudent) return null;
  const t = BADGE_TONES[role];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, flexDirection: 'row', alignItems: 'center' }]}>
      {role === 'observer' && <Ionicons name="eye-outline" size={11} color={t.fg} style={{ marginRight: 3 }} />}
      <Text style={[styles.badgeText, { color: t.fg }]}>{ROLE_LABELS[role]}</Text>
    </View>
  );
}

export function Pill({ text, tone = 'neutral', icon }: { text: string; tone?: 'neutral' | 'success' | 'accent'; icon?: IconName }) {
  const t = {
    neutral: { bg: colors.surfaceAlt, fg: colors.muted },
    success: { bg: colors.successSoft, fg: colors.success },
    accent: { bg: colors.accentSoft, fg: colors.accentText },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, flexDirection: 'row', alignItems: 'center' }]}>
      {icon && <Ionicons name={icon} size={11} color={t.fg} style={{ marginRight: 3 }} />}
      <Text style={[styles.badgeText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
      <Text style={[font.h2, { textAlign: 'center' }]}>{title}</Text>
      {body && <Text style={[font.small, { textAlign: 'center', marginTop: 6, maxWidth: 300 }]}>{body}</Text>}
      {action && <View style={{ marginTop: space.lg }}>{action}</View>}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            {o.icon && <Ionicons name={o.icon} size={15} color={active ? colors.primary : colors.muted} style={{ marginRight: 4 }} />}
            <Text numberOfLines={1} style={[styles.segmentText, active && { color: colors.primary }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={[styles.row, { justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.sm }]}>
      <Text style={font.label}>{title}</Text>
      {action}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <Text style={[styles.error, { marginBottom: space.md }]}>{children}</Text> : null;
}

export function Loading() {
  return (
    <View style={{ padding: space.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  buttonText: { fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 6 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.md,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: space.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.muted },
});
