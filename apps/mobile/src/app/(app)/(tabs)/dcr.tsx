import type { Dcr } from '@ariforce/contracts';
import { useQueries } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { SelectSheet } from '@/components/masters/select-sheet';
import {
  mockTpCard,
  rangeLabel,
  useMyTps,
  type TpDraftCard,
  type TpItem,
} from '@/lib/tp/adapter';
import { tpPillLabel } from '@/lib/tp/calendar';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { FloatingFab, useFabScrollPad } from '@/components/floating-fab';
import { TabScene } from '@/components/floating-tab-bar';
import { MonthCalendar } from '@/components/tp/month-calendar';
import { DcrStatusSections } from '@/components/dcr/status-sections';
import { apiFetch } from '@/lib/api';
import {
  useDeleteDraft,
  useDraftList,
  useDcrOptions,
  useDcrTerritories,
  useSubmittedHistory,
} from '@/lib/dcr/api';
import { reviewOf, useDecisions } from '@/lib/dcr/adapter';
import {
  dcrListLabel,
  dcrPillLabel,
  dcrPillsByDate,
  groupDcrs,
} from '@/lib/dcr/calendar';
import { dateLabel, todayIST } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { normaliseWorkTypes, territoryRows, type CallKind } from '@/lib/dcr/model';
import { useAuth } from '@/lib/auth-context';
import { isSalesRole } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

const OUTLET_PATH: Record<CallKind, string> = {
  doctor: '/v1/doctors',
  chemist: '/v1/chemists',
  stockist: '/v1/stockists',
};

function monthRange(year: number, monthIndex: number) {
  const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

/**
 * DCR workspace: month calendar (Outlook-style day labels) + Approved / Pending /
 * Rejected / Drafts / Drafts from TP. New DCR FAB.
 */
export default function DcrTab() {
  const { user } = useAuth();
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  return <DcrWorkspace />;
}

function DcrWorkspace() {
  const router = useRouter();
  const scrollPad = useFabScrollPad();
  const today = todayIST();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y!, monthIndex: m! - 1 };
  });
  const [selected, setSelected] = useState<string | null>(today);
  const range = useMemo(
    () => monthRange(cursor.year, cursor.monthIndex),
    [cursor.year, cursor.monthIndex],
  );

  const draftsQ = useDraftList();
  const historyQ = useSubmittedHistory(range.from, range.to);
  const optionsQ = useDcrOptions(today);
  const terrQ = useDcrTerritories(true);
  const remove = useDeleteDraft();
  const decisionsQ = useDecisions();
  const { user } = useAuth();
  const tpsQ = useMyTps(user?.id);
  const approvedTps = useMemo(
    () => (tpsQ.data ?? []).filter((t) => t.status === 'approved' && t.to >= today),
    [tpsQ.data, today],
  );
  const tpFrom = approvedTps.reduce((m, t) => (t.from < m ? t.from : m), today);
  const tpTo = approvedTps.reduce((m, t) => (t.to > m ? t.to : m), today);
  const tpFiledQ = useSubmittedHistory(tpFrom, tpTo);
  const [pickTp, setPickTp] = useState<TpDraftCard | null>(null);

  const wtName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of normaliseWorkTypes(optionsQ.data?.workTypes ?? [])) map.set(w.id, w.name);
    return map;
  }, [optionsQ.data]);

  const terrName = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of territoryRows(terrQ.data ?? [])) map.set(r.id, r.name);
    return map;
  }, [terrQ.data]);

  const historyRows = useMemo(
    () =>
      (historyQ.data?.items ?? [])
        .filter((d) => d.status !== 'draft')
        .map((d) => ({ d, review: reviewOf(d, decisionsQ.data) })),
    [historyQ.data, decisionsQ.data],
  );

  const draftRows = useMemo(
    () =>
      (draftsQ.data?.items ?? [])
        .filter((d) => d.status === 'draft')
        .map((d) => ({ d, review: reviewOf(d, decisionsQ.data) })),
    [draftsQ.data, decisionsQ.data],
  );

  const allRows = useMemo(() => [...draftRows, ...historyRows], [draftRows, historyRows]);

  // Resolve real doctor / chemist / stockist names for calendar pills.
  const outletRefs = useMemo(() => {
    const seen = new Map<string, { kind: CallKind; id: string }>();
    for (const { d } of allRows) {
      for (const c of d.calls ?? []) {
        const k = `${c.outletKind}:${c.outletId}`;
        if (!seen.has(k)) seen.set(k, { kind: c.outletKind, id: c.outletId });
      }
    }
    return [...seen.values()];
  }, [allRows]);

  const outletQs = useQueries({
    queries: outletRefs.map((o) => ({
      queryKey: ['outlet', o.kind, o.id],
      staleTime: 10 * 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiFetch<{ name: string }>(`${OUTLET_PATH[o.kind]}/${o.id}`, { signal }),
    })),
  });

  const outletName = useMemo(() => {
    const m = new Map<string, string>();
    outletRefs.forEach((o, i) => {
      const n = outletQs[i]?.data?.name?.trim();
      if (n) m.set(o.id, n);
    });
    return m;
  }, [outletRefs, outletQs]);

  const names = useMemo(
    () => ({ territory: terrName, workType: wtName, outlet: outletName }),
    [terrName, wtName, outletName],
  );

  const tpCards = useMemo(() => {
    const live = (optionsQ.data as { tourPlanDrafts?: TpDraftCard[] } | undefined)?.tourPlanDrafts;
    if (live) return [...live].sort((a, b) => a.from.localeCompare(b.from));
    const filed = new Set(
      (tpFiledQ.data?.items ?? [])
        .filter((d) => d.status !== 'draft')
        .map((d) => d.date),
    );
    const drafted = new Set(
      (draftsQ.data?.items ?? []).filter((d) => d.status === 'draft').map((d) => d.date),
    );
    return approvedTps
      .map((t) => mockTpCard(t, filed, drafted, today))
      .filter((c): c is TpDraftCard => !!c)
      .sort((a, b) => a.from.localeCompare(b.from));
  }, [optionsQ.data, approvedTps, tpFiledQ.data, draftsQ.data, today]);

  const pillLabelOf = useMemo(() => (d: Dcr) => dcrPillLabel(d, names), [names]);
  const listLabelOf = useMemo(() => (d: Dcr) => dcrListLabel(d, names), [names]);
  const tpPillOf = useMemo(
    () => (t: TpDraftCard) => tpPillLabel(t as TpItem, names),
    [names],
  );
  const tpListOf = useMemo(() => {
    return (t: TpDraftCard) => {
      const base = tpPillLabel(t as TpItem, names);
      return base ? `TP · ${base}` : `TP · ${rangeLabel(t.from, t.to)}`;
    };
  }, [names]);

  const pills = useMemo(
    () => dcrPillsByDate(allRows, tpCards, pillLabelOf, tpPillOf, names),
    [allRows, tpCards, pillLabelOf, tpPillOf, names],
  );
  const groups = useMemo(() => groupDcrs(allRows), [allRows]);

  const refresh = () =>
    Promise.all([
      draftsQ.refetch(),
      historyQ.refetch(),
      optionsQ.refetch(),
      tpsQ.refetch(),
      terrQ.refetch(),
    ]);

  const openForm = (params: { id?: string; date?: string; new?: string; tp?: string }) =>
    router.push({ pathname: '/dcr/form', params });

  const openTpDay = (t: TpDraftCard, date: string) => openForm({ new: '1', date, tp: t.id });

  const confirmDelete = (d: Dcr) => {
    Alert.alert(
      'Delete this draft?',
      `The draft for ${dateLabel(d.date)}${wtName.get(d.workTypeId) ? ` (${wtName.get(d.workTypeId)})` : ''} and its calls will be deleted. This can’t be undone.`,
      [
        { text: 'Keep draft', style: 'cancel' },
        {
          text: 'Delete draft',
          style: 'destructive',
          onPress: () => {
            remove.mutate(d.id, {
              onError: (e) => Alert.alert('Could not delete', saveMessage(e)),
            });
          },
        },
      ],
    );
  };

  function onSelectDay(date: string, dayPills: { itemId: string; status: string }[]) {
    setSelected(date);
    if (dayPills.length === 1) {
      const p = dayPills[0]!;
      if (p.itemId.startsWith('tp:')) {
        const id = p.itemId.slice(3);
        const card = tpCards.find((t) => t.id === id);
        if (card) openTpDay(card, date);
        return;
      }
      openForm({ id: p.itemId, date });
      return;
    }
    if (!dayPills.length) openForm({ new: '1', date });
  }

  const listError = draftsQ.isError
    ? saveMessage(draftsQ.error)
    : historyQ.isError
      ? saveMessage(historyQ.error)
      : null;

  const loading = draftsQ.isPending && historyQ.isPending;
  const empty =
    !allRows.length && !tpCards.length && !draftsQ.isPending && !historyQ.isPending;

  return (
    <TabScene>
      <View style={styles.flex}>
        <PullToRefresh onRefresh={refresh}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: scrollPad }]}
          >
            {listError ? (
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">{listError}</AppText>
                <Pressable onPress={refresh} accessibilityRole="button" style={styles.retry}>
                  <Icon name="refresh" color={colors.navy} />
                  <AppText variant="action">Retry</AppText>
                </Pressable>
              </Card>
            ) : null}

            {loading ? (
              <SkeletonList count={4} />
            ) : (
              <>
                <MonthCalendar
                  year={cursor.year}
                  monthIndex={cursor.monthIndex}
                  selected={selected}
                  pills={pills}
                  onSelectMonth={(year, monthIndex) => setCursor({ year, monthIndex })}
                  onSelectDay={onSelectDay}
                />

                {empty ? (
                  <Card style={styles.pad}>
                    <AppText variant="body">No DCRs yet</AppText>
                    <AppText variant="bodyMuted">
                      Start today’s report with New DCR. Approved tour-plan days show as pills on
                      the calendar until you file them.
                    </AppText>
                  </Card>
                ) : (
                  <View style={styles.lists}>
                    <DcrStatusSections
                      approved={groups.approved}
                      pending={groups.pending}
                      rejected={groups.rejected}
                      drafts={groups.drafts}
                      tpCards={tpCards}
                      labelOf={listLabelOf}
                      tpLabelOf={tpListOf}
                      onOpenDcr={(d) => openForm({ id: d.id, date: d.date })}
                      onOpenTp={(t) =>
                        t.pendingDates.length === 1
                          ? openTpDay(t, t.pendingDates[0]!)
                          : setPickTp(t)
                      }
                      onDeleteDraft={confirmDelete}
                    />
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </PullToRefresh>

        <SelectSheet
          visible={!!pickTp}
          title={pickTp ? `File a day · ${rangeLabel(pickTp.from, pickTp.to)}` : 'File a day'}
          options={(pickTp?.pendingDates ?? []).map((d) => ({
            value: d,
            label: dateLabel(d),
            hint: pickTp?.fileableDates.includes(d)
              ? 'Today · can submit'
              : pickTp?.draftDates.includes(d)
                ? 'Draft saved · submit on the day'
                : 'Draft until the day',
          }))}
          value={null}
          onPick={(d) => {
            const t = pickTp;
            setPickTp(null);
            if (d && t) openTpDay(t, d);
          }}
          onClose={() => setPickTp(null)}
        />

        <FloatingFab
          label="New DCR"
          accessibilityLabel="New DCR"
          onPress={() => openForm({ new: '1', date: today })}
        />
      </View>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: spacing.sm, gap: spacing.md },
  lists: { paddingHorizontal: layout.gutter },
  pad: { marginHorizontal: layout.gutter, padding: spacing.lg, gap: spacing.sm },
  retry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
});
