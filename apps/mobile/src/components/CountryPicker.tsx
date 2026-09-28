/**
 * Country field for the profile: tap to open a searchable list. The list comes from the API
 * (GET /countries), which is also what the server accepts, so the two can't drift apart.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { api } from '../lib/api';
import { colors, font, radius, space } from '../lib/theme';
import { Text } from './Text';
import { ErrorText, Input, styles as ui } from './ui';

export interface Country {
  code: string;
  name: string;
}

let cache: Country[] | null = null;

export function useCountries() {
  const [countries, setCountries] = useState<Country[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cache) return;
    api
      .get<{ countries: Country[] }>('/countries')
      .then((r) => setCountries((cache = r.countries)))
      .catch((e) => setError(e.message));
  }, []);
  return { countries, error };
}

export function CountryPicker({ label = 'Country', value, onChange }: { label?: string; value: string; onChange: (code: string) => void }) {
  const { countries, error } = useCountries();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = countries?.find((c) => c.code === value);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!countries || !needle) return countries ?? [];
    // Match the start of any word, so "kingdom" finds United Kingdom and "sa" finds Saudi Arabia.
    return countries.filter((c) => c.name.toLowerCase().split(/[\s-]+/).some((w) => w.startsWith(needle)));
  }, [countries, q]);

  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    setQ('');
  };

  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[font.label, { marginBottom: 6 }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.name ?? 'not set'}`}
        onPress={() => setOpen(true)}
        style={[ui.input, ui.row, { justifyContent: 'space-between' }]}
      >
        <Text style={{ fontSize: 16, color: selected ? colors.text : colors.muted }}>{selected?.name ?? 'Choose your country'}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <ErrorText>{error}</ErrorText>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: colors.bg,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              height: '85%',
              width: '100%',
              maxWidth: 560,
              alignSelf: 'center',
              padding: space.lg,
            }}
          >
            <View style={[ui.row, { justifyContent: 'space-between', marginBottom: space.md }]}>
              <Text style={font.h2}>Choose your country</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <Input value={q} onChangeText={setQ} placeholder="Search countries" autoCorrect={false} autoFocus />
            <FlatList
              data={shown}
              keyExtractor={(c) => c.code}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                value ? (
                  <Row name="No country" muted onPress={() => choose('')} />
                ) : null
              }
              ListEmptyComponent={<Text style={[font.small, { padding: space.md }]}>{countries ? 'No country matches that.' : 'Loading…'}</Text>}
              renderItem={({ item }) => <Row name={item.name} selected={item.code === value} onPress={() => choose(item.code)} />}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ name, selected, muted, onPress }: { name: string; selected?: boolean; muted?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        ui.row,
        {
          justifyContent: 'space-between',
          paddingVertical: 12,
          paddingHorizontal: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      <Text style={{ fontSize: 16, color: muted ? colors.muted : colors.text, fontWeight: selected ? '600' : '400' }}>{name}</Text>
      {selected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
    </Pressable>
  );
}
