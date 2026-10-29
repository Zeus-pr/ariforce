import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { SearchBox } from '@/components/masters/search-box';
import { List } from '@/components/scroll';
import { SkeletonSheetRows } from '@/components/skeleton';
import { colors, layout, radius, sizes, spacing, touch } from '@/theme';

export type PickOption = { value: string; label: string; hint?: string };

/** Multi-select bottom sheet (territories, work-with). Done applies the selection. */
export function MultiSelectSheet({
  visible,
  title,
  options,
  values,
  onDone,
  onClose,
  onSearch,
  loading,
}: {
  visible: boolean;
  title: string;
  options: PickOption[];
  values: string[];
  onDone: (ids: string[]) => void;
  onClose: () => void;
  /** Server search: called with the typed text (the caller debounces); always shows the box. */
  onSearch?: (q: string) => void;
  loading?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>(values);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? options.filter(
          (o) => o.label.toLowerCase().includes(s) || o.hint?.toLowerCase().includes(s),
        )
      : options;
  }, [options, q]);

  useEffect(() => {
    if (visible) setPicked(values);
  }, [visible, values]);

  const search = (v: string) => {
    setQ(v);
    onSearch?.(v);
  };

  const toggle = (id: string) =>
    setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable
        style={styles.scrim}
        onPress={() => {
          search('');
          onClose();
        }}
        accessibilityLabel="Close"
      />
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
        {onSearch || options.length > 8 ? (
          <View style={styles.search}>
            <SearchBox value={q} onChange={search} placeholder={`Search ${title.toLowerCase()}`} />
          </View>
        ) : null}
        <List
          data={rows}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          ListEmptyComponent={
            loading ? (
              <SkeletonSheetRows count={6} />
            ) : (
              <AppText variant="bodyMuted" style={styles.empty}>
                Nothing matches.
              </AppText>
            )
          }
          renderItem={({ item }) => {
            const on = picked.includes(item.value);
            return (
              <Pressable
                onPress={() => toggle(item.value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.flex}>
                  <AppText variant="body" numberOfLines={1}>
                    {item.label}
                  </AppText>
                  {item.hint ? (
                    <AppText variant="small" numberOfLines={1}>
                      {item.hint}
                    </AppText>
                  ) : null}
                </View>
                {on ? <Icon name="check" color={colors.tealDeep} /> : null}
              </Pressable>
            );
          }}
        />
        <View style={styles.footer}>
          <Button
            label={picked.length ? `Done (${picked.length})` : 'Done'}
            onPress={() => {
              onDone(picked);
              search('');
              onClose();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(15, 42, 74, 0.35)' },
  sheet: {
    maxHeight: '85%',
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
  empty: { padding: layout.gutter, textAlign: 'center' },
  footer: { paddingHorizontal: layout.gutter, paddingTop: spacing.md },
});
