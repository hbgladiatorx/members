/** Edit your own profile: photo, details and privacy settings. */
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '../../components/Text';
import { ChangePasswordForm } from '../../components/ChangePassword';
import { CountryPicker } from '../../components/CountryPicker';
import { Avatar, Button, Card, ErrorText, Input, SectionHeader, styles as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, font, space } from '../../lib/theme';
import type { User } from '../../lib/types';

export default function ProfileScreen() {
  const { user, setUser, signOut } = useAuth();
  const [form, setForm] = useState({
    displayName: '', bio: '', city: '', country: '', postalCode: '', languages: '', helpWith: '', showEmail: false, allowDms: true,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Load the full profile (the sign-in response only carries the basics).
  useEffect(() => {
    api
      .get<{ user: User }>('/me')
      .then(({ user: u }) => {
        setUser(u);
        setForm({
          displayName: u.displayName,
          bio: u.bio ?? '',
          city: u.city ?? '',
          country: u.country ?? '',
          postalCode: u.postalCode ?? '',
          languages: (u.languages ?? []).join(', '),
          helpWith: u.helpWith ?? '',
          showEmail: !!u.showEmail,
          allowDms: u.allowDms ?? true,
        });
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [setUser]);

  if (!user) return null;
  const set = (k: keyof typeof form) => (v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const languages = form.languages.split(',').map((l) => l.trim()).filter(Boolean);
      const res = await api.patch<{ user: User }>('/me', { ...form, languages });
      setUser(res.user);
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async () => {
    setError(null);
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError('Photo access is off. Turn it on in Settings to choose a picture.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const res = await api.uploadImage<{ user: User }>('/me/avatar', result.assets[0]);
      setUser(res.user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    setError(null);
    try {
      setUser((await api.del<{ user: User }>('/me/avatar')).user);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {/* Photo */}
        <View style={{ alignItems: 'center', marginBottom: space.lg }}>
          <Pressable onPress={pickPhoto} accessibilityRole="button" accessibilityLabel="Change profile photo" disabled={uploading}>
            <Avatar name={user.displayName} url={user.avatarUrl} size={104} />
            <View
              style={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: colors.primary,
                borderWidth: 3,
                borderColor: colors.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={16} color="#fff" />}
            </View>
          </Pressable>
          <View style={[ui.row, { gap: space.sm, marginTop: space.md }]}>
            <Button small variant="secondary" title={user.avatarUrl ? 'Change photo' : 'Add photo'} onPress={pickPhoto} disabled={uploading} />
            {user.avatarUrl && <Button small variant="ghost" title="Remove" onPress={removePhoto} />}
          </View>
        </View>

        <ErrorText>{error}</ErrorText>

        <SectionHeader title="About you" />
        <Card>
          <Input label="Name" value={form.displayName} onChangeText={set('displayName')} maxLength={80} />
          <Input
            label="Bio"
            value={form.bio}
            onChangeText={set('bio')}
            multiline
            maxLength={500}
            placeholder="A line or two about yourself, what you do, why you're studying."
          />
          <Text style={[font.small, { fontSize: 11, textAlign: 'right', marginTop: -8, marginBottom: space.sm }]}>{form.bio.length}/500</Text>
          <Input label="City" value={form.city} onChangeText={set('city')} maxLength={80} placeholder="e.g. Dearborn" autoComplete="postal-address-locality" />
          <CountryPicker value={form.country} onChange={set('country')} />
          <Input
            label="Postal code"
            value={form.postalCode}
            onChangeText={set('postalCode')}
            maxLength={20}
            autoCapitalize="characters"
            autoComplete="postal-code"
            placeholder="Only you and administrators see this"
          />
          <Input label="Languages" value={form.languages} onChangeText={set('languages')} placeholder="e.g. English, Arabic, Urdu" />
          <Input label="I can help with" value={form.helpWith} onChangeText={set('helpWith')} maxLength={200} placeholder="e.g. Arabic grammar, note-taking" />
        </Card>

        <SectionHeader title="Privacy" />
        <Card>
          <Toggle
            title="Show my email to classmates"
            body="Off by default. Teachers and classmates see only your name and profile."
            value={form.showEmail}
            onChange={set('showEmail')}
          />
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.md }} />
          <Toggle
            title="Allow direct messages"
            body="When off, classmates can't start a new chat with you. Class staff still can."
            value={form.allowDms}
            onChange={set('allowDms')}
          />
          <Text style={[font.small, { marginTop: space.md }]}>
            Only people in your classes can see your profile. Your email is {form.showEmail ? 'visible to them' : 'hidden'}.
          </Text>
        </Card>

        <Button title={saved ? 'Saved' : 'Save profile'} icon={saved ? 'checkmark' : undefined} onPress={save} loading={saving} disabled={!loaded || !form.displayName.trim()} />
        <View style={{ height: space.md }} />
        <Button
          variant="secondary"
          icon="eye-outline"
          title="See how classmates see me"
          onPress={() => router.push(`/user/${user.id}`)}
        />
        {user.isAdmin && (
          <>
            <SectionHeader title="Administration" />
            <Button variant="secondary" icon="people-outline" title="Manage people" onPress={() => router.push('/admin')} />
          </>
        )}
        <SectionHeader title="Account" />
        <ChangeEmail />
        <ChangePassword />
        <View style={{ height: space.md }} />
        <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={signOut} />
        <View style={{ height: space.xl }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Change the sign-in email. The server asks for the current password. */
function ChangeEmail() {
  const { user, setUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (!user) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<{ user: User }>('/me/email', { email: email.trim(), password });
      setUser(res.user);
      setOpen(false);
      setPassword('');
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={font.label}>Email</Text>
      <Text style={[font.body, { marginTop: 4 }]}>{user.email}</Text>
      {done && <Text style={[font.small, { color: colors.success, marginTop: 4 }]}>Email changed. Use it next time you sign in.</Text>}
      {!open ? (
        <View style={{ marginTop: space.md, alignSelf: 'flex-start' }}>
          <Button small variant="secondary" icon="mail-outline" title="Change email" onPress={() => { setOpen(true); setDone(false); setEmail(user.email); }} />
        </View>
      ) : (
        <View style={{ marginTop: space.md }}>
          <Input label="New email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
          <Input label="Current password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={save} />
          <ErrorText>{error}</ErrorText>
          <View style={[ui.row, { gap: space.sm }]}>
            <Button small title="Save email" onPress={save} loading={busy} disabled={!email.trim() || !password} />
            <Button small variant="ghost" title="Cancel" onPress={() => { setOpen(false); setError(null); setPassword(''); }} />
          </View>
        </View>
      )}
    </Card>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Card>
      <Text style={font.label}>Password</Text>
      {done && <Text style={[font.small, { color: colors.success, marginTop: 4 }]}>Password changed.</Text>}
      {!open ? (
        <View style={{ marginTop: space.md, alignSelf: 'flex-start' }}>
          <Button small variant="secondary" icon="key-outline" title="Change password" onPress={() => { setOpen(true); setDone(false); }} />
        </View>
      ) : (
        <View style={{ marginTop: space.md }}>
          <ChangePasswordForm onDone={() => { setOpen(false); setDone(true); }} />
          <View style={{ marginTop: space.sm, alignSelf: 'flex-start' }}>
            <Button small variant="ghost" title="Cancel" onPress={() => setOpen(false)} />
          </View>
        </View>
      )}
    </Card>
  );
}

function Toggle({ title, body, value, onChange }: { title: string; body: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[ui.row, { justifyContent: 'space-between' }]}>
      <View style={{ flex: 1, marginRight: space.md }}>
        <Text style={[font.body, { fontWeight: '600' }]}>{title}</Text>
        <Text style={font.small}>{body}</Text>
      </View>
      <Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} />
    </View>
  );
}
