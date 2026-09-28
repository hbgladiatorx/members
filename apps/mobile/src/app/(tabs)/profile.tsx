/** Edit your own profile: photo, details and privacy settings. */
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Avatar, Button, Card, ErrorText, Input, SectionHeader, styles as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, font, space } from '../../lib/theme';
import type { User } from '../../lib/types';

export default function ProfileScreen() {
  const { user, setUser, signOut } = useAuth();
  const [form, setForm] = useState({ displayName: '', bio: '', city: '', languages: '', helpWith: '', showEmail: false, allowDms: true });
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
          <Input label="City" value={form.city} onChangeText={set('city')} maxLength={80} placeholder="e.g. Dearborn" />
          <Input label="Languages" value={form.languages} onChangeText={set('languages')} placeholder="e.g. English, Arabic, Urdu" />
          <Input label="I can help with" value={form.helpWith} onChangeText={set('helpWith')} maxLength={200} placeholder="e.g. Arabic grammar, note-taking" />
        </Card>

        <SectionHeader title="Privacy" />
        <Card>
          <Toggle
            title="Show my email to classmates"
            body="Off by default. Instructors and classmates see only your name and profile."
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
        <View style={{ height: space.xl }} />
        <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={signOut} />
        <Text style={[font.small, { textAlign: 'center', marginTop: space.md }]}>{user.email}</Text>
        <View style={{ height: space.xl }} />
      </ScrollView>
    </KeyboardAvoidingView>
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
