import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { KpiKey, KpiReport } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { PullToRefresh } from '@/components/refresh';
import { List, ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { todayIST } from '@/lib/dcr/dates';
import { formatKpi, KPI_LABEL, monthKey, monthShort } from '@/lib/perf';
import { colors, layout, radius, spacing } from '@/theme';

type Territory = { id: string; name: string; parentId: string | null };
type Row = KpiReport['rows'][number];
type Frame = { kind: 'place' | 'person'; id: string; title: string };

const LIST_KPIS = ['coverage_pct', 'call_average', 'dcr_compliance_pct'] as const;
const PERSON_KPIS = [
  'coverage_pct',
  'dcr_compliance_pct',
  'tp_adherence_pct',
  'missed_doctor_pct',
  'call_average',
] as const satisfies readonly KpiKey[];

const SHEET = { duration: 300, dampingRatio: 0.8, overshootClamping: true } as const;
/** A full bar is a strong full-day doctor call average. The number beside it is the real figure. */
const CALL_FULL = 12;

function rowId(row: Row) {
  return row.userId ?? row.territoryId ?? row.label;
}

function callOf(row: Row | undefined) {
  return row?.metrics.find((item) => item.kpi === 'call_average')?.value ?? null;
}

function rank(rows: Row[]) {
  return [...rows].sort((a, b) => {
    const av = callOf(a);
    const bv = callOf(b);
    if (av == null && bv == null) return a.label.localeCompare(b.label);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av || a.label.localeCompare(b.label);
  });
}

async function loadTerritories() {
  const items: Territory[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < 8; n++) {
    const page = await apiFetch<{ items: Territory[]; nextCursor?: string | null }>(
      '/v1/territories',
      { query: { limit: 200, ...(cursor ? { cursor } : {}) } },
    );
    items.push(...(page.items ?? []));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

async function loadLevel(month: string, territoryId: string, people: boolean) {
  const base = {
    rollup: people ? 'byUser' : 'byTerritory',
    territoryId,
    kpis: LIST_KPIS.join(','),
  };
  const [report, earlier] = await Promise.all([
    apiFetch<KpiReport>('/v1/kpis', { query: { ...base, month } }),
    apiFetch<KpiReport>('/v1/kpis', { query: { ...base, month: monthKey(-1, month) } }),
  ]);
  const keep = (rows: Row[]) => rows.filter((row) => people || row.territoryId !== territoryId);
  const here = people ? null : (report.rows.find((row) => row.territoryId === territoryId) ?? null);
  const earlierHere = people
    ? null
    : (earlier.rows.find((row) => row.territoryId === territoryId) ?? null);
  const prev = new Map(keep(earlier.rows).map((row) => [rowId(row), callOf(row)]));
  if (here) prev.set(rowId(here), callOf(earlierHere ?? undefined));
  return { here, rows: rank(keep(report.rows)), prev };
}

function metricOf(row: Row, key: (typeof LIST_KPIS)[number]) {
  return row.metrics.find((item) => item.kpi === key) ?? null;
}

function ScoreBody({ row, previous }: { row: Row; previous: number | null }) {
  const coverage = metricOf(row, 'coverage_pct');
  const reports = metricOf(row, 'dcr_compliance_pct');
  const call = callOf(row);
  const delta = call != null && previous != null ? call - previous : null;
  const flat = delta != null && Math.abs(delta) < 0.05;
  const callWidth = call == null ? 0 : Math.max(0, Math.min(100, (call / CALL_FULL) * 100));
  const coverWidth = coverage?.value == null ? 0 : Math.max(0, Math.min(100, coverage.value));
  return (
    <View style={styles.scoreBody}>
      <View style={styles.scoreTop}>
        <AppText variant="label" numberOfLines={1} style={styles.rowName}>
          {row.label}
        </AppText>
        <AppText variant="section">{call == null ? '—' : call.toFixed(1)}</AppText>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${callWidth}%` }]} />
      </View>
      <View style={styles.scoreMeta}>
        <View style={styles.thinTrack}>
          <View style={[styles.thinFill, { width: `${coverWidth}%` }]} />
        </View>
        <AppText variant="small" numberOfLines={1} style={styles.metaCopy}>
          {coverage ? formatKpi(coverage.unit, coverage.value) : '—'} coverage
          {reports ? ` · ${formatKpi(reports.unit, reports.value)} reports` : ''}
        </AppText>
        {delta != null ? (
          <AppText
            variant="small"
            style={{ color: flat ? colors.muted : delta > 0 ? colors.success : colors.danger }}
          >
            {flat ? '0' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function Score({
  row,
  previous,
  onPress,
}: {
  row: Row;
  previous: number | null;
  onPress?: () => void;
}) {
  if (!onPress) {
    return (
      <View style={styles.score}>
        <ScoreBody row={row} previous={previous} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.label}, call average ${callOf(row) == null ? 'none' : callOf(row)!.toFixed(1)}`}
      style={({ pressed }) => [styles.score, pressed && styles.pressed]}
    >
      <ScoreBody row={row} previous={previous} />
    </Pressable>
  );
}

function MonthRail({ month, onMonth }: { month: string; onMonth: (next: string) => void }) {
  const now = todayIST().slice(0, 7);
  const end = month < monthKey(-5, now) ? month : now;
  const months = Array.from({ length: 6 }, (_, i) => monthKey(i - 5, end));
  const atCurrent = month >= now;
  const pick = (next: string) => {
    onMonth(next);
    void Haptics.selectionAsync();
  };
  return (
    <View style={styles.rail}>
      <View style={styles.railRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => pick(monthKey(-1, month))}
          hitSlop={8}
          style={styles.railBtn}
        >
          <Icon name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <View style={styles.chips}>
          {months.map((item) => {
            const on = item === month;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => pick(item)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <AppText variant="label" style={on ? styles.chipOnText : styles.chipText}>
                  {monthShort(item)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={atCurrent}
          onPress={() => pick(monthKey(1, month))}
          hitSlop={8}
          style={styles.railBtn}
        >
          <Icon
            name="chevron-right"
            size={22}
            color={atCurrent ? colors.borderStrong : colors.ink}
          />
        </Pressable>
      </View>
      {month === now ? <AppText variant="small">So far</AppText> : null}
    </View>
  );
}

function tick() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function Bars({
  metrics,
  earlier,
}: {
  metrics: Row['metrics'] | undefined;
  earlier: Row['metrics'] | undefined;
}) {
  return (
    <View style={styles.bars}>
      {PERSON_KPIS.map((key) => {
        const metric = metrics?.find((item) => item.kpi === key);
        const value = metric?.value ?? null;
        const before = earlier?.find((item) => item.kpi === key)?.value ?? null;
        const delta =
          key === 'call_average' && value != null && before != null ? value - before : null;
        const flat = delta != null && Math.abs(delta) < 0.05;
        const width =
          key === 'call_average' && value != null
            ? `${Math.max(0, Math.min(100, (value / CALL_FULL) * 100))}%`
            : metric?.unit === 'percent' && value != null
              ? `${Math.max(0, Math.min(100, value))}%`
              : null;
        return (
          <View key={key} style={styles.barRow}>
            <View style={styles.barCopy}>
              <AppText variant="body">{KPI_LABEL[key]}</AppText>
              <View style={styles.barValue}>
                <AppText variant="section">{metric ? formatKpi(metric.unit, value) : '—'}</AppText>
                {delta != null ? (
                  <AppText
                    variant="small"
                    style={{
                      color: flat ? colors.muted : delta > 0 ? colors.success : colors.danger,
                    }}
                  >
                    {flat ? '0' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`}
                  </AppText>
                ) : null}
              </View>
            </View>
            {width ? (
              <View style={styles.track}>
                <View style={[styles.fill, { width }]} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** One screen. The month rail stays put while a sheet holds the next place or the person. */
export function TeamPlace() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const bottom = useBottomSpace();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [month, setMonth] = useState(() => monthKey());
  const [stack, setStack] = useState<Frame[]>([]);
  const sheetH = Math.max(360, height - insets.top - 8);
  const hiddenY = sheetH;
  const halfY = Math.round(sheetH * 0.42);
  const y = useSharedValue(sheetH);
  const startY = useSharedValue(0);
  const hidden = useSharedValue(sheetH);
  const half = useSharedValue(halfY);
  const reducedSv = useSharedValue(reduced);

  useEffect(() => {
    hidden.set(hiddenY);
    half.set(halfY);
    reducedSv.set(reduced);
  }, [half, halfY, hidden, hiddenY, reduced, reducedSv]);

  const open = stack.length > 0;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    const to = open ? halfY : hiddenY;
    if (reduced) y.set(to);
    else y.set(withSpring(to, SHEET));
  }, [halfY, hiddenY, open, reduced, y]);

  const boot = useQuery({
    queryKey: ['team', 'territories'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [territories, me] = await Promise.all([
        loadTerritories(),
        apiFetch<{ territoryIds?: string[] }>('/v1/me'),
      ]);
      const own = territories.find((t) => me.territoryIds?.includes(t.id));
      const root = territories.find((t) => t.parentId == null) ?? null;
      const home = roles.includes('director') || !own ? root : own;
      return { territories, home };
    },
  });
  const home = boot.data?.home ?? null;
  const homeLeaf = !!home && !boot.data?.territories.some((t) => t.parentId === home.id);
  const homeRows = useQuery({
    queryKey: ['team', 'rows', month, home?.id, homeLeaf],
    enabled: !!home,
    staleTime: 60_000,
    queryFn: () => loadLevel(month, home!.id, homeLeaf),
  });

  const top = stack.at(-1) ?? null;
  const place =
    top?.kind === 'place' ? boot.data?.territories.find((t) => t.id === top.id) : undefined;
  const placeLeaf = !!place && !boot.data?.territories.some((t) => t.parentId === place.id);
  const placeRows = useQuery({
    queryKey: ['team', 'sheet', month, top?.id, placeLeaf],
    enabled: top?.kind === 'place' && !!place,
    staleTime: 60_000,
    queryFn: () => loadLevel(month, place!.id, placeLeaf),
  });
  const person = useQuery({
    queryKey: ['team', 'person', month, top?.kind === 'person' ? top.id : null],
    enabled: top?.kind === 'person',
    staleTime: 60_000,
    queryFn: async () => {
      const query = { rollup: 'self', userId: top!.id, kpis: PERSON_KPIS.join(',') };
      const [now, before] = await Promise.all([
        apiFetch<KpiReport>('/v1/kpis', { query: { ...query, month } }),
        apiFetch<KpiReport>('/v1/kpis', { query: { ...query, month: monthKey(-1, month) } }),
      ]);
      return { row: now.rows[0] ?? null, earlier: before.rows[0]?.metrics };
    },
  });

  const close = () => setStack([]);
  const pop = () => setStack((frames) => frames.slice(0, -1));
  const openRow = (row: Row, people: boolean) => {
    if (!people && row.territoryId) {
      setStack((frames) => [...frames, { kind: 'place', id: row.territoryId!, title: row.label }]);
      return;
    }
    if (row.userId)
      setStack((frames) => [...frames, { kind: 'person', id: row.userId!, title: row.label }]);
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      startY.set(y.get());
    })
    .onUpdate((e) => {
      const next = Math.min(hidden.get(), Math.max(0, startY.get() + e.translationY));
      y.set(next);
    })
    .onEnd((e) => {
      const pos = y.get();
      const hide = hidden.get();
      const mid = half.get();
      let dest = mid;
      if (e.velocityY > 900 || pos > (mid + hide) / 2) dest = hide;
      else if (e.velocityY < -900 || pos < mid / 2) dest = 0;
      const spring = reducedSv.get()
        ? { duration: 1, dampingRatio: 1, overshootClamping: true }
        : { ...SHEET, velocity: e.velocityY };
      y.set(withSpring(dest, spring));
      scheduleOnRN(tick);
      if (dest === hide) scheduleOnRN(close);
    });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(0.28, (1 - y.get() / Math.max(hidden.get(), 1)) * 0.28)),
  }));

  const waiting = boot.isPending || homeRows.isLoading;
  const failed = boot.isError || homeRows.isError;
  const data = homeRows.data?.rows ?? [];
  const here = homeRows.data?.here ?? null;
  const prev = homeRows.data?.prev;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: home?.name ?? 'Team' }} />
      <PullToRefresh
        onRefresh={() =>
          Promise.all([boot.refetch(), homeRows.refetch(), placeRows.refetch(), person.refetch()])
        }
      >
        <List
          style={styles.flex}
          data={waiting || failed ? [] : data}
          keyExtractor={(row) => row.userId ?? row.territoryId ?? row.label}
          contentContainerStyle={{ paddingBottom: bottom }}
          ListHeaderComponent={
            <View style={styles.header}>
              <MonthRail month={month} onMonth={setMonth} />
              {here ? <Score row={here} previous={prev?.get(rowId(here)) ?? null} /> : null}
            </View>
          }
          ListEmptyComponent={
            waiting ? (
              <SkeletonList count={6} />
            ) : (
              <AppText variant="bodyMuted" style={styles.empty}>
                {failed
                  ? 'Could not load this team. Pull to try again.'
                  : `Nothing under ${home?.name ?? 'here'} this month.`}
              </AppText>
            )
          }
          renderItem={({ item }) => (
            <Score
              row={item}
              previous={prev?.get(rowId(item)) ?? null}
              onPress={() => openRow(item, homeLeaf)}
            />
          )}
        />
      </PullToRefresh>

      <Animated.View
        pointerEvents={stack.length ? 'auto' : 'none'}
        style={[styles.scrim, scrimStyle]}
      >
        <Pressable style={styles.flex} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { height: sheetH }, sheetStyle]}>
        <GestureDetector gesture={pan}>
          <View
            style={styles.handleHit}
            accessibilityRole="adjustable"
            accessibilityLabel="Drag the sheet"
          >
            <View style={styles.handle} />
          </View>
        </GestureDetector>
        <View style={styles.sheetHead}>
          {stack.length > 1 ? (
            <Pressable
              onPress={pop}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
              style={styles.back}
            >
              <Icon name="chevron-left" size={22} color={colors.ink} />
            </Pressable>
          ) : null}
          <AppText variant="section" numberOfLines={1} style={styles.name}>
            {top?.title ?? ''}
          </AppText>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: hiddenY - halfY + bottom }}>
          {top?.kind === 'person' ? (
            person.isLoading ? (
              <SkeletonList count={5} />
            ) : person.isError ? (
              <AppText variant="bodyMuted" style={styles.empty}>
                Could not load this person. Pull to try again.
              </AppText>
            ) : (
              <Bars metrics={person.data?.row?.metrics} earlier={person.data?.earlier} />
            )
          ) : placeRows.isLoading ? (
            <SkeletonList count={4} />
          ) : placeRows.isError ? (
            <AppText variant="bodyMuted" style={styles.empty}>
              Could not load this place. Pull to try again.
            </AppText>
          ) : (
            (placeRows.data?.rows ?? []).map((row) => (
              <Score
                key={rowId(row)}
                row={row}
                previous={placeRows.data?.prev.get(rowId(row)) ?? null}
                onPress={() => openRow(row, placeLeaf)}
              />
            ))
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { alignItems: 'stretch', paddingBottom: spacing.sm, gap: spacing.sm },
  rail: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  railRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  railBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { flex: 1, flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  chip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.tealWash,
    paddingVertical: spacing.sm,
  },
  chipOn: { backgroundColor: colors.navy },
  chipText: { color: colors.tealDeep },
  chipOnText: { color: colors.onNavy },
  empty: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg },
  score: {
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  scoreBody: { gap: spacing.sm },
  scoreTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowName: { flex: 1 },
  scoreMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaCopy: { flex: 1 },
  thinTrack: {
    width: 64,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.tealWash,
    overflow: 'hidden',
  },
  thinFill: { height: 4, borderRadius: 2, backgroundColor: colors.ink },
  pressed: { backgroundColor: colors.tealWash },
  name: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.navy },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handleHit: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  sheetHead: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.gutter,
    paddingBottom: spacing.sm,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bars: { paddingHorizontal: layout.gutter, gap: spacing.lg, paddingTop: spacing.sm },
  barRow: { gap: spacing.sm },
  barCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  barValue: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.tealWash, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.tealDeep },
});
