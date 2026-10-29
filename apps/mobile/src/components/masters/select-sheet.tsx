import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { List } from '@/components/scroll';
import type { Option } from '@/lib/masters';
import { colors, layout, radius, sizes, spacing, touch } from '@/theme';
import { SearchBox } from './search-box';

/**
 * Bottom-sheet picker for a lookup (territory, specialty, category). Searchable, because a
 * company can have hundreds of territories. `noneLabel` adds a first row that clears the value.
 */
export function SelectSheet({
  visible,
  title,
  options,
  value,
  noneLabel,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Option[];
  value: string | null;
  noneLabel?: string;
  onPick: (v: string | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
    return noneLabel && !s ? [{ value: '', label: noneLabel }, ...list] : list;
  }, [options, q, noneLabel]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <AppText variant="section" accessibilityRole="header" style={styles.flex}>
            {title}
          </AppText>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.close}
          >
            <Icon name="close" />
          </Pressable>
        </View>
        {options.length > 8 ? (
          <View style={styles.search}>
            <SearchBox value={q} onChange={setQ} placeholder={`Search ${title.toLowerCase()}`} />
          </View>
        ) : null}
        <List
          data={rows}
          keyExtractor={(o) => o.value || '__none'}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          ListEmptyComponent={
            <AppText variant="bodyMuted" style={styles.empty}>
              Nothing matches.
            </AppText>
          }
          renderItem={({ item }) => {
            const selected = (value ?? '') === item.value;
            return (
              <Pressable
                onPress={() => {
                  onPick(item.value || null);
                  setQ('');
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.flex}>
                  <AppText variant="body" numberOfLines={1}>
                    {item.label}
                  </AppText>
                  {item.hint ? (
                    <AppText variant="small" numberOfLines={1} style={styles.hint}>
                      {item.hint}
                    </AppText>
                  ) : null}
                </View>
                {selected ? <Icon name="check" color={colors.tealDeep} /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(15, 42, 74, 0.35)' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: colors.ground,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderCurve: 'continuous',
  },
  grip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: layout.gutter,
    paddingRight: spacing.xs,
    minHeight: sizes.header,
  },
  close: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  search: { paddingHorizontal: layout.gutter, paddingBottom: spacing.sm },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.control,
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  pressed: { backgroundColor: colors.separator },
  hint: { textTransform: 'capitalize' },
  empty: { padding: layout.gutter, textAlign: 'center' },
});
