/**
 * A date field with a pop-up month calendar. Pure React Native, so it looks and works the same on
 * iOS, Android and the web. Value is 'YYYY-MM-DD' (what the API stores) or '' for no date.
 * All arithmetic is in UTC so a date never shifts by a day across time zones.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { colors, font, radius, space } from '../lib/theme';
import { Text } from './Text';
import { Button, styles as ui } from './ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Fixed row height: a height derived from a percentage width isn't counted when the web sizes the card.
const CELL = 44;
const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parse(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? { y: +m[1]!, m: +m[2]! - 1, d: +m[3]! } : null;
}

function todayParts() {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}

/** "Tue, 6 Oct 2026" */
export function formatLongDate(value: string) {
  const p = parse(value);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m, p.d)).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function DateField({ label, value, onChange, placeholder = 'Choose a date' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const start = parse(value) ?? todayParts();
  const [view, setView] = useState({ y: start.y, m: start.m });

  const show = () => {
    const s = parse(value) ?? todayParts();
    setView({ y: s.y, m: s.m });
    setOpen(true);
  };
  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const shift = (delta: number) =>
    setView((v) => {
      const d = new Date(Date.UTC(v.y, v.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  const firstWeekday = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const today = todayParts();
  const todayIso = toIso(today.y, today.m, today.d);
  const monthLabel = new Date(Date.UTC(view.y, view.m, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[font.label, { marginBottom: 6 }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatLongDate(value) : 'not set'}`}
        onPress={show}
        style={[ui.input, ui.row, { justifyContent: 'space-between' }]}
      >
        <Text style={{ fontSize: 16, color: value ? colors.text : colors.muted }}>{value ? formatLongDate(value) : placeholder}</Text>
        <Ionicons name="calendar-outline" size={18} color={colors.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: space.lg }}>
          {/* Inner Pressable swallows taps so they don't close the calendar. */}
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, width: '100%', maxWidth: 380, alignSelf: 'center' }}>
            <View style={[ui.row, { justifyContent: 'space-between', marginBottom: space.md }]}>
              <Pressable accessibilityLabel="Previous month" onPress={() => shift(-1)} hitSlop={10} style={{ padding: 4 }}>
                <Ionicons name="chevron-back" size={22} color={colors.primary} />
              </Pressable>
              <Text style={font.h2}>{monthLabel}</Text>
              <Pressable accessibilityLabel="Next month" onPress={() => shift(1)} hitSlop={10} style={{ padding: 4 }}>
                <Ionicons name="chevron-forward" size={22} color={colors.primary} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row' }}>
              {WEEKDAYS.map((w) => (
                <Text key={w} style={[font.small, { flex: 1, textAlign: 'center', fontSize: 12, marginBottom: space.xs }]}>
                  {w}
                </Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((d, i) => {
                if (!d) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, height: CELL }} />;
                const iso = toIso(view.y, view.m, d);
                const selected = iso === value;
                const isToday = iso === todayIso;
                return (
                  <Pressable
                    key={iso}
                    accessibilityRole="button"
                    accessibilityLabel={formatLongDate(iso)}
                    accessibilityState={{ selected }}
                    onPress={() => choose(iso)}
                    style={{ width: `${100 / 7}%`, height: CELL, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: selected ? colors.primary : 'transparent',
                        borderWidth: isToday && !selected ? 1 : 0,
                        borderColor: colors.primary,
                      }}
                    >
                      <Text style={{ fontSize: 15, color: selected ? colors.onPrimary : colors.text, fontWeight: selected ? '700' : '400' }}>{d}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={[ui.row, { justifyContent: 'space-between', marginTop: space.md }]}>
              <Button small variant="ghost" title="Clear" onPress={() => choose('')} />
              <Button small variant="secondary" title="Today" onPress={() => choose(todayIso)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
