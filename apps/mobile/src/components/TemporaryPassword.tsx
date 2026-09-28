/**
 * Shows a temporary password once, right after an administrator creates an account or resets a
 * password, with a ready-made message to pass on. The server keeps only a hash, so it can't be shown again.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { API_URL } from '../lib/api';
import { colors, font, radius, space } from '../lib/theme';
import { Button, Card, styles as ui } from './ui';

// The app is served from the same address as the API, minus /api.
const SIGN_IN_URL = new URL(API_URL).origin;

export function inviteMessage(email: string, password: string) {
  return (
    `You have an account on Mainstay Classes.\n\n` +
    `Sign in at ${SIGN_IN_URL}\nEmail: ${email}\nTemporary password: ${password}\n\n` +
    `You'll choose your own password when you sign in.`
  );
}

export function TemporaryPasswordCard({
  title,
  email,
  password,
  onDismiss,
}: {
  title: string;
  email: string;
  password: string;
  onDismiss?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const message = inviteMessage(email, password);

  const pass = async () => {
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(message);
      setCopied(true);
    } else {
      await Share.share({ message });
    }
  };

  return (
    <Card style={{ borderColor: colors.accent, backgroundColor: '#FFFCF5' }}>
      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
        <Text style={[font.body, { fontWeight: '700', flex: 1 }]}>{title}</Text>
        {onDismiss && (
          <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>
      <Text style={[font.small, { marginTop: space.sm }]}>Email</Text>
      <Text selectable style={font.body}>{email}</Text>
      <Text style={[font.small, { marginTop: space.sm }]}>Temporary password</Text>
      <Text
        selectable
        accessibilityLabel={`Temporary password ${password}`}
        style={{
          fontSize: 22,
          fontWeight: '700',
          letterSpacing: 1,
          color: colors.text,
          fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
          backgroundColor: colors.surface,
          borderRadius: radius.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          marginTop: 4,
          alignSelf: 'flex-start',
        }}
      >
        {password}
      </Text>
      <Text style={[font.small, { marginTop: space.md }]}>
        Send this to them now; it won’t be shown again. They’ll choose their own password when they sign in.
      </Text>
      <View style={{ marginTop: space.md, alignSelf: 'flex-start' }}>
        <Button
          small
          icon={Platform.OS === 'web' ? (copied ? 'checkmark' : 'copy-outline') : 'share-outline'}
          title={Platform.OS === 'web' ? (copied ? 'Copied' : 'Copy sign-in message') : 'Share sign-in message'}
          onPress={pass}
        />
      </View>
    </Card>
  );
}
