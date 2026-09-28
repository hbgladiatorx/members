/** Change-password form, used on the first-sign-in screen and in Profile → Account. */
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors, font, space } from '../lib/theme';
import type { User } from '../lib/types';
import { Button, ErrorText, Input } from './ui';

export function ChangePasswordForm({ currentLabel = 'Current password', onDone }: { currentLabel?: string; onDone?: () => void }) {
  const { setUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = !!confirm && next !== confirm;
  const save = async () => {
    if (next.length < 10) return setError('Your new password must be at least 10 characters.');
    if (next !== confirm) return setError('The two new passwords don’t match.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<{ user: User }>('/me/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setUser(res.user);
      onDone?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Input label={currentLabel} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
      <Input label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" placeholder="At least 10 characters" />
      <Input label="New password again" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" onSubmitEditing={save} />
      {mismatch && <Text style={[font.small, { color: colors.danger, marginTop: -space.sm, marginBottom: space.sm }]}>The two new passwords don’t match.</Text>}
      <ErrorText>{error}</ErrorText>
      <Button title="Save password" onPress={save} loading={busy} disabled={!current || !next || !confirm} />
    </View>
  );
}
