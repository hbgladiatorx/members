import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText, Input, Logo, Segmented } from '../components/ui';
import { useAuth } from '../lib/auth';
import { colors, font, space } from '../lib/theme';

export default function SignIn() {
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'in') await signIn(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl }} keyboardShouldPersistTaps="handled">
          <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center' }}>
            {/* Clear space around the logo, per the brand guide; nothing attached to it. */}
            <View style={{ paddingVertical: space.lg, marginBottom: space.lg }}>
              <Logo width={260} />
            </View>
            <Text style={[font.title, { fontSize: 26 }]}>Mainstay Classes</Text>
            <Text style={[font.small, { fontSize: 15, marginTop: 4, marginBottom: space.xl }]}>
              Your classes, syllabus, questions and conversations in one place.
            </Text>

            <Segmented
              value={mode}
              onChange={(v) => {
                setMode(v);
                setError(null);
              }}
              options={[
                { value: 'in', label: 'Sign in' },
                { value: 'up', label: 'Create account' },
              ]}
            />
            <View style={{ height: space.xl }} />

            {mode === 'up' && <Input label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />}
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              textContentType={mode === 'in' ? 'password' : 'newPassword'}
              onSubmitEditing={submit}
              placeholder={mode === 'up' ? 'At least 10 characters' : undefined}
            />
            <ErrorText>{error}</ErrorText>
            <Button
              title={mode === 'in' ? 'Sign in' : 'Create account'}
              onPress={submit}
              loading={busy}
              disabled={!email || !password || (mode === 'up' && !name)}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
