import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { SearchBox } from '@/components/masters/search-box';
import { SelectSheet } from '@/components/masters/select-sheet';
import { List, ScrollView } from '@/components/scroll';
import { SkeletonGroup, SkeletonList, SkeletonRow } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { FEATURES } from '@/lib/features';
import {
  APPROVAL_LABEL,
  FILTERS,
  isMasterKind,
  isPlaceholderName,
  MASTERS,
  optionsFor,
  useLookups,
  useMasterList,
  type ListFilters,
  type MasterKind,
  type MasterRow,
} from '@/lib/masters';
import { canWriteMasters } from '@/lib/roles';
import { colors, layout, radius, shadows, spacing, touch } from '@/theme';

const FILTER_LABEL = { territoryId: 'Territory', specialtyId: 'Specialty', categoryId: 'Category' };
const ALL_LABEL = {
  territoryId: 'All territories',
  specialtyId: 'All specialties',
  categoryId: 'All categories',
};
const FILTER_TYPE = {
  territoryId: 'territory',
  specialtyId: 'specialty',
  categoryId: 'category',
} as const;

export default function MasterListScreen() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  if (!isMasterKind(kind)) return <Redirect href="/business" />;
  return <MasterList kind={kind} />;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Doctors / chemists / stockists list (web masters-view.tsx + doctors-view.tsx DoctorList):
 * server search, the same filters, cursor paging. RBM and above get the Add button.
 */
function MasterList({ kind }: { kind: MasterKind }) {
  const cfg = MASTERS[kind];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const canWrite = canWriteMasters(user?.roles ?? []);
  const lk = useLookups();
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [filters, setFilters] = useState<ListFilters>({});
  const [picking, setPicking] = useState<keyof ListFilters | null>(null);
  const list = useMasterList(kind, q, filters);

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total;
  const bottom = insets.bottom + layout.section + (canWrite ? touch.control + spacing.lg : 0);

  const subtitle = (r: MasterRow) => {
    const name = (id: string | null | undefined) => (id ? lk.byId.get(id) : undefined);
    const parts =
      kind === 'doctors' && 'specialtyId' in r
        ? [name(r.specialtyId), name(r.territoryId), r.city]
        : [name(r.territoryId), r.city, r.phone];
    return parts.filter(Boolean).join(' · ') || '—';
  };

  const tag = (r: MasterRow) => {
    if ('approvalStatus' in r && r.approvalStatus && r.approvalStatus !== 'approved')
      return (
        <Chip
          label={APPROVAL_LABEL[r.approvalStatus] ?? r.approvalStatus}
          tone={r.approvalStatus === 'rejected' ? 'red' : 'orange'}
        />
      );
    if (kind === 'doctors' && isPlaceholderName(r.name))
      return <Chip label="Placeholder" tone="neutral" />;
    if (kind === 'doctors' && 'categoryId' in r && r.categoryId && lk.byId.get(r.categoryId))
      return <Chip label={lk.byId.get(r.categoryId)!} tone="teal" />;
    return null;
  };

  const pickingType = picking ? FILTER_TYPE[picking] : null;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: cfg.title }} />
      <View style={styles.top}>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={`Search ${cfg.title.toLowerCase()}`}
        />
        <ScrollView
          horizontal
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {FILTERS[kind].map((k) => {
            const v = filters[k];
            const active = !!v;
            return (
              <Pressable
                key={k}
                onPress={() => setPicking(k)}
                accessibilityRole="button"
                accessibilityLabel={`${FILTER_LABEL[k]} filter${active ? `: ${lk.byId.get(v) ?? ''}` : ''}`}
                style={[styles.filter, active && styles.filterOn]}
              >
                <AppText
                  variant="action"
                  numberOfLines={1}
                  style={[styles.filterText, active && styles.filterTextOn]}
                >
                  {active ? (lk.byId.get(v) ?? FILTER_LABEL[k]) : FILTER_LABEL[k]}
                </AppText>
                <Icon name="chevron-down" size={18} color={active ? colors.onNavy : colors.muted} />
              </Pressable>
            );
          })}
        </ScrollView>
        {typeof total === 'number' ? (
          <AppText variant="small">
            {total} {total === 1 ? cfg.singular : cfg.title.toLowerCase()}
          </AppText>
        ) : null}
      </View>

      <List
        data={rows}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.listContent, { paddingBottom: bottom }]}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => void list.refetch()}
            tintColor={colors.navy}
            colors={[colors.navy]}
          />
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.item,
              index === 0 && styles.first,
              index === rows.length - 1 && styles.last,
            ]}
          >
            <ListRow
              title={item.name}
              subtitle={subtitle(item)}
              icon={FEATURES[kind].icon}
              tone={FEATURES[kind].tone}
              trailing={tag(item)}
              divider={index < rows.length - 1}
              onPress={() =>
                router.push({ pathname: '/masters/[kind]/[id]', params: { kind, id: item.id } })
              }
            />
          </View>
        )}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <SkeletonGroup style={styles.moreRows}>
              <SkeletonRow divider />
              <SkeletonRow />
            </SkeletonGroup>
          ) : undefined
        }
        ListEmptyComponent={
          list.isPending ? (
            <SkeletonList count={8} />
          ) : (
            <View style={styles.empty}>
              <AppText variant="bodyMuted" style={styles.center}>
                {list.isError
                  ? (list.error as Error).message
                  : q || Object.values(filters).some(Boolean)
                    ? `No ${cfg.title.toLowerCase()} match.`
                    : `No ${cfg.title.toLowerCase()} yet.`}
              </AppText>
            </View>
          )
        }
      />

      {canWrite ? (
        <Pressable
          onPress={() => router.push({ pathname: '/masters/[kind]/form', params: { kind } })}
          accessibilityRole="button"
          accessibilityLabel={`Add ${cfg.singular}`}
          style={({ pressed }) => [
            styles.fab,
            { bottom: insets.bottom + spacing.lg },
            pressed && styles.fabPressed,
          ]}
        >
          <Icon name="plus" color={colors.onNavy} />
          <AppText variant="button" style={styles.fabText}>
            Add {cfg.singular}
          </AppText>
        </Pressable>
      ) : null}

      <SelectSheet
        visible={!!picking}
        title={picking ? FILTER_LABEL[picking] : ''}
        options={pickingType ? (optionsFor(pickingType, lk) ?? []) : []}
        value={picking ? (filters[picking] ?? null) : null}
        noneLabel={picking ? ALL_LABEL[picking] : undefined}
        onPick={(v) => picking && setFilters((f) => ({ ...f, [picking]: v ?? undefined }))}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  top: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.sm },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 36,
    maxWidth: 220,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  filterOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterText: { color: colors.ink, flexShrink: 1 },
  filterTextOn: { color: colors.onNavy },
  listContent: { paddingHorizontal: layout.gutter, paddingTop: spacing.md, flexGrow: 1 },
  item: { backgroundColor: colors.surface, overflow: 'hidden' },
  first: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  last: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  moreRows: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  empty: { paddingVertical: spacing.xxxl, paddingHorizontal: layout.gutter },
  center: { textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: touch.control,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    backgroundColor: colors.navy,
    boxShadow: shadows.floating,
  },
  fabPressed: { backgroundColor: colors.navyPressed },
  fabText: { color: colors.onNavy },
});
