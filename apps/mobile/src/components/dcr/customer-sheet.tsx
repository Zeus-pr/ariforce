import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { SearchBox } from '@/components/masters/search-box';
import { List } from '@/components/scroll';
import { useCustomers, type CustomerRow, type CustomerScope } from '@/lib/dcr/api';
import { thrownMessage } from '@/lib/dcr/errors';
import { KIND_LABEL, type CallKind } from '@/lib/dcr/model';
import { APPROVAL_LABEL } from '@/lib/masters';
import { colors, layout, radius, sizes, spacing, touch } from '@/theme';

/** Same words as the website's picker (web components/pickers/pickers.tsx). */
const REJECTED = 'Rejected by your manager; cannot be reported';

export type PickedCustomer = { id: string; name: string; hqId: string };

/**
 * Pick the customer of a call: server search (debounced) and "load more" paging over the day's
 * HQs/territories. Rejected doctors stay visible but disabled, pending ones carry a badge.
 */
export function CustomerSheet({
  visible,
  kind,
  scopes,
  names,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  kind: CallKind;
  scopes: CustomerScope[];
  /** HQ and territory names by id (hints). */
  names: Map<string, string>;
  value: string | null;
  onPick: (c: PickedCustomer) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const list = useCustomers(kind, scopes, q, visible);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: CustomerRow[] = [];
    for (const p of list.data?.pages ?? [])
      for (const x of p.items) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        out.push(x);
      }
    return out;
  }, [list.data]);

  const close = () => {
    setSearch('');
    onClose();
  };
  const label = KIND_LABEL[kind];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <AppText variant="section" accessibilityRole="header" style={styles.flex}>
            {label}
          </AppText>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.close}
          >
            <Icon name="close" />
          </Pressable>
        </View>
        <View style={styles.search}>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={`Search ${label.toLowerCase()}s`}
          />
        </View>
        <List
          data={rows}
          keyExtractor={(x) => x.id}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <ActivityIndicator color={colors.navy} style={styles.more} />
            ) : undefined
          }
          ListEmptyComponent={
            list.isPending ? (
              <ActivityIndicator color={colors.navy} style={styles.more} />
            ) : (
              <AppText variant="bodyMuted" style={styles.empty}>
                {list.isError
                  ? thrownMessage(list.error)
                  : q
                    ? 'Nothing matches.'
                    : `No ${label.toLowerCase()}s in the day's territories.`}
              </AppText>
            )
          }
          renderItem={({ item }) => {
            const rejected = kind === 'doctor' && item.approvalStatus === 'rejected';
            const pending = kind === 'doctor' && item.approvalStatus === 'pending';
            const hint = rejected
              ? REJECTED
              : [
                  item.city,
                  item.localTerritoryId ? names.get(item.localTerritoryId) : null,
                  item.territoryId ? names.get(item.territoryId) : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
            const selected = value === item.id;
            return (
              <Pressable
                disabled={rejected}
                onPress={() => {
                  onPick({
                    id: item.id,
                    name: item.name,
                    hqId: item.territoryId ?? scopes[0]?.hqId ?? '',
                  });
                  close();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: rejected }}
                accessibilityLabel={`${item.name}${hint ? `, ${hint}` : ''}`}
                style={({ pressed }) => [
                  styles.row,
                  rejected && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.flex}>
                  <AppText variant="body" numberOfLines={1}>
                    {item.name}
                  </AppText>
                  {hint ? (
                    <AppText variant="small" numberOfLines={1}>
                      {hint}
                    </AppText>
                  ) : null}
                </View>
                {pending ? <Chip label={APPROVAL_LABEL.pending!} tone="orange" /> : null}
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
    height: '85%',
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
  list: { flex: 1 },
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
  disabled: { opacity: 0.5 },
  pressed: { backgroundColor: colors.separator },
  more: { paddingVertical: spacing.xl },
  empty: { padding: layout.gutter, textAlign: 'center' },
});
