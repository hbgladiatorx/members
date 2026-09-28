import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Button, Card, Empty, ErrorText, Input, Loading, RoleBadge, styles as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, font, space } from '../../lib/theme';
import type { ClassSummary } from '../../lib/types';
import { formatDate, useFetch } from '../../lib/useFetch';

export default function ClassesScreen() {
  const { user } = useAuth();
  const { data, error, refreshing, reload } = useFetch<{ classes: ClassSummary[] }>('/classes');
  const [panel, setPanel] = useState<'none' | 'join' | 'create'>('none');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res =
        panel === 'join'
          ? await api.post<{ class: ClassSummary }>('/classes/join', { code: value.trim() })
          : await api.post<{ class: ClassSummary }>('/classes', { title: value.trim() });
      setPanel('none');
      setValue('');
      router.push(`/class/${res.class.id}`);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={{ marginBottom: space.md }}>
      <View style={[ui.row, { gap: space.sm }]}>
        <Button
          small
          icon="enter-outline"
          title="Join with code"
          variant={panel === 'join' ? 'primary' : 'secondary'}
          onPress={() => setPanel(panel === 'join' ? 'none' : 'join')}
          style={{ flex: 1 }}
        />
        <Button
          small
          icon="add"
          title="New class"
          variant={panel === 'create' ? 'primary' : 'secondary'}
          onPress={() => setPanel(panel === 'create' ? 'none' : 'create')}
          style={{ flex: 1 }}
        />
      </View>
      {panel !== 'none' && (
        <Card style={{ marginTop: space.md }}>
          <Input
            label={panel === 'join' ? 'Class code' : 'Class title'}
            placeholder={panel === 'join' ? 'e.g. K7PQ2MX' : 'e.g. Introduction to Fiqh'}
            value={value}
            onChangeText={setValue}
            autoCapitalize={panel === 'join' ? 'characters' : 'sentences'}
            autoFocus
            onSubmitEditing={submit}
          />
          <ErrorText>{formError}</ErrorText>
          <Button title={panel === 'join' ? 'Join class' : 'Create class'} onPress={submit} loading={busy} disabled={!value.trim()} />
        </Card>
      )}
    </View>
  );

  return (
    <FlatList
      data={data?.classes ?? []}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.primary} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        !data ? (
          error ? <ErrorText>{error}</ErrorText> : <Loading />
        ) : (
          <Empty
            icon="school-outline"
            title="No classes yet"
            body="Join a class with the code your teacher shared, or create your own class to teach."
          />
        )
      }
      renderItem={({ item }) => (
        <Card onPress={() => router.push(`/class/${item.id}`)}>
          <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
            <Text style={[font.h2, { flex: 1, marginRight: space.sm }]} numberOfLines={2}>
              {item.title}
            </Text>
            <RoleBadge role={user?.isAdmin ? 'admin' : item.role} />
          </View>
          {!!item.description && (
            <Text style={[font.small, { marginTop: 4 }]} numberOfLines={2}>
              {item.description}
            </Text>
          )}
          <View style={[ui.row, { marginTop: space.md, gap: space.lg }]}>
            <Meta icon="people-outline" text={`${item.memberCount} member${item.memberCount === 1 ? '' : 's'}`} />
            {item.startsOn && <Meta icon="calendar-outline" text={`Starts ${formatDate(item.startsOn)}`} />}
            {item.archivedAt && <Meta icon="archive-outline" text="Archived" />}
          </View>
        </Card>
      )}
    />
  );
}

function Meta({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={ui.row}>
      <Ionicons name={icon} size={14} color={colors.muted} style={{ marginRight: 4 }} />
      <Text style={font.small}>{text}</Text>
    </View>
  );
}
