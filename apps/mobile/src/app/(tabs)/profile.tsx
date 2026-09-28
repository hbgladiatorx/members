import { ScrollView, Text, View } from 'react-native';
import { Avatar, Button, Card } from '../../components/ui';
import { API_URL } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { font, space } from '../../lib/theme';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
        <Avatar name={user.displayName} size={72} />
        <Text style={[font.title, { marginTop: space.md }]}>{user.displayName}</Text>
        <Text style={font.small}>{user.email}</Text>
      </Card>
      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={signOut} />
      <Text style={[font.small, { textAlign: 'center', marginTop: space.xl, fontSize: 11 }]}>Server: {API_URL}</Text>
      <View style={{ height: space.xl }} />
    </ScrollView>
  );
}
