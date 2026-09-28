/**
 * Administrators: add a person. Creates the account with a temporary password (or, if the email
 * already has an account, adds that person to the chosen class) and shows the password to pass on.
 */
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '../components/Text';
import { TemporaryPasswordCard } from '../components/TemporaryPassword';
import { Button, Card, ErrorText, Input, styles as ui } from '../components/ui';
import { api } from '../lib/api';
import { colors, font, radius, space } from '../lib/theme';
import { ROLE_LABELS, type ClassSummary, type Role } from '../lib/types';
import { useFetch } from '../lib/useFetch';

const ROLES: Role[] = ['student', 'instructor', 'assistant', 'observer'];

interface AddResult {
  user: { id: string; displayName: string; email: string };
  created: boolean;
  temporaryPassword: string | null;
  addedToClass: boolean;
}

export default function AddUserScreen() {
  const classes = useFetch<{ classes: ClassSummary[] }>('/classes');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [classId, setClassId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('student');
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(AddResult & { classTitle: string | null; role: Role }) | null>(null);

  const open = (classes.data?.classes ?? []).filter((c) => !c.archivedAt);
  const classTitle = open.find((c) => c.id === classId)?.title ?? null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<AddResult>('/admin/users', { displayName: name.trim(), email: email.trim(), classId, role, admin });
      setResult({ ...r, classTitle, role });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setResult(null);
    setName('');
    setEmail('');
    setAdmin(false);
  };

  const cancel = (
    <Pressable onPress={() => router.back()} hitSlop={8} style={{ marginHorizontal: 12 }}>
      <Text style={{ color: colors.primary, fontSize: 16 }}>{result ? 'Done' : 'Cancel'}</Text>
    </Pressable>
  );

  if (result) {
    const where = result.addedToClass && result.classTitle ? ` as ${ROLE_LABELS[result.role]} in ${result.classTitle}` : '';
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Stack.Screen options={{ title: 'Add user', headerLeft: () => cancel }} />
        {result.created && result.temporaryPassword ? (
          <TemporaryPasswordCard
            title={`${result.user.displayName} was added${where}.`}
            email={result.user.email}
            password={result.temporaryPassword}
          />
        ) : (
          <Card>
            <Text style={[font.body, { fontWeight: '700' }]}>
              {result.user.displayName} already had an account, so they were added{where || ''}{admin ? ' and made an administrator' : ''}.
            </Text>
            <Text style={[font.small, { marginTop: space.sm }]}>They sign in with their usual email and password.</Text>
          </Card>
        )}
        <Button icon="person-add-outline" title="Add another person" variant="secondary" onPress={again} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Add user', headerLeft: () => cancel }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Khadija Noor" maxLength={80} autoFocus />
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="They sign in with this"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        <Text style={[font.label, { marginBottom: 6 }]}>Class (optional)</Text>
        <View style={[ui.row, { flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }]}>
          <Choice label="No class" selected={!classId} onPress={() => setClassId(null)} />
          {open.map((c) => (
            <Choice key={c.id} label={c.title} selected={classId === c.id} onPress={() => setClassId(c.id)} />
          ))}
        </View>

        {classId && (
          <>
            <Text style={[font.label, { marginBottom: 6 }]}>Role in {classTitle}</Text>
            <View style={[ui.row, { flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }]}>
              {ROLES.map((r) => (
                <Choice key={r} label={ROLE_LABELS[r]} selected={role === r} onPress={() => setRole(r)} />
              ))}
            </View>
          </>
        )}

        <View style={[ui.row, { justifyContent: 'space-between', marginBottom: space.lg }]}>
          <View style={{ flex: 1, marginRight: space.md }}>
            <Text style={[font.body, { fontWeight: '600' }]}>Administrator</Text>
            <Text style={font.small}>Can see every class and manage people.</Text>
          </View>
          <Switch accessibilityLabel="Administrator" value={admin} onValueChange={setAdmin} trackColor={{ true: colors.primary, false: colors.border }} />
        </View>

        <ErrorText>{error}</ErrorText>
        <Button title="Add user" icon="person-add-outline" onPress={submit} loading={busy} disabled={!name.trim() || !email.trim()} />
        <Text style={[font.small, { marginTop: space.md, textAlign: 'center' }]}>
          You’ll get a temporary password to send them. They choose their own when they first sign in.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={{
        paddingHorizontal: space.md,
        paddingVertical: 7,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary : colors.surface,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '600', color: selected ? '#fff' : colors.text }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
