/** Shown instead of the app until someone with a temporary password chooses their own. */
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Text } from '../components/Text';
import { ChangePasswordForm } from '../components/ChangePassword';
import { Button, Card, Logo } from '../components/ui';
import { useAuth } from '../lib/auth';
import { colors, font, space } from '../lib/theme';

export default function ChangePasswordScreen() {
  const { user, signOut } = useAuth();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.xxl, maxWidth: 480, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: space.lg }}>
          <Logo variant="mark" width={48} />
        </View>
        <Text style={font.title}>Choose your password</Text>
        <Text style={[font.body, { color: colors.muted, marginTop: space.sm, marginBottom: space.lg }]}>
          Welcome{user ? `, ${user.displayName.split(' ')[0]}` : ''}. You signed in with a temporary password. Choose your own to continue; only you will know it.
        </Text>
        <Card>
          <ChangePasswordForm currentLabel="Temporary password" />
        </Card>
        <View style={{ height: space.md }} />
        <Button variant="ghost" title="Sign out" onPress={signOut} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
