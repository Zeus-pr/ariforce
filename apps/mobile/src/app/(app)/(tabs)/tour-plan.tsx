import { Redirect, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { FloatingFab, useFabScrollPad } from '@/components/floating-fab';
import { TabScene } from '@/components/floating-tab-bar';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { SlideToConfirm } from '@/components/slide-to-confirm';
import { MonthCalendar } from '@/components/tp/month-calendar';
import { StatusSections } from '@/components/tp/status-sections';
import { useAuth } from '@/lib/auth-context';
import { useDcrOptions, useDcrTerritories } from '@/lib/dcr/api';
import { todayIST } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { normaliseWorkTypes, territoryRows } from '@/lib/dcr/model';
import { useLeaveData } from '@/lib/leave';
import { isSalesRole } from '@/lib/roles';
import {
  CONTRACT,
  rangeLabel,
  tpDefaultFromDate,
  tpFutureMonthCutoffError,
  tpMessage,
  useMyTps,
  useSubmitMonthTp,
  type TpItem,
} from '@/lib/tp/adapter';
import {
  exemptLeaveDates,
  monthEnd,
  monthView,
  nextYm,
  planForDay,
  type MonthItem,
} from '@/lib/tp/month';
import { groupByStatus, pillsByDate, tpListLabel, tpPillLabel } from '@/lib/tp/calendar';
import { colors, layout, radius, spacing } from '@/theme';

/** Tour plans: Stitch month calendar + status lists, New TP FAB. */
export default function TourPlanTab() {
  const { user } = useAuth();
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  return <TourPlans myId={user?.id} />;
}

function TourPlans({ myId }: { myId?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const scrollPad = useFabScrollPad();
  const q = useMyTps(myId);
  const leave = useLeaveData();
  const sendMonth = useSubmitMonthTp();
  const optionsQ = useDcrOptions(todayIST());
  const terrQ = useDcrTerritories(true);
  const today = todayIST();
  const openFrom = tpDefaultFromDate();
  const [cursor, setCursor] = useState(() => {
    const anchor = openFrom ?? today;
    const [y, m] = anchor.split('-').map(Number);
    return { year: y!, monthIndex: m! - 1 };
  });
  const [selected, setSelected] = useState<string | null>(openFrom);

  const wtName = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of normaliseWorkTypes(optionsQ.data?.workTypes ?? [])) m.set(w.id, w.name);
    return m;
  }, [optionsQ.data]);

  const terrName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of territoryRows(terrQ.data ?? [])) m.set(r.id, r.name);
    return m;
  }, [terrQ.data]);

  const items = q.data ?? [];
  const names = useMemo(() => ({ territory: terrName, workType: wtName }), [terrName, wtName]);
  const pillLabelOf = useMemo(
    () => (t: TpItem, date: string) => tpPillLabel({ ...t, plan: planForDay(t.plan, date) }, names),
    [names],
  );
  const listLabelOf = useMemo(() => (t: TpItem) => tpListLabel(t, names), [names]);

  const pills = useMemo(() => pillsByDate(items, pillLabelOf), [items, pillLabelOf]);
  const groups = useMemo(() => groupByStatus(items), [items]);
  const nextFrom = `${nextYm(today.slice(0, 7))}-01`;
  const nextTo = monthEnd(nextFrom.slice(0, 7));
  const offs = leave.data?.settings.weeklyOffDays ?? [0];
  const month = useMemo(() => {
    const leaveDates = exemptLeaveDates(leave.data?.requests, nextFrom, nextTo, offs);
    return monthView(items as MonthItem[], nextFrom, nextTo, leaveDates, offs);
  }, [items, leave.data?.requests, nextFrom, nextTo, offs]);

  async function sendWholeMonth() {
    if (month.kind !== 'ready' || !user) return false;
    const first = month.days[0];
    if (!first) return false;
    try {
      await sendMonth.mutateAsync({
        from: month.from,
        to: month.to,
        draftIds: month.draftIds,
        user: { id: user.id, name: user.name ?? user.email ?? '' },
        plan: {
          workTypeId: first.workTypeId,
          territoryIds: first.territoryIds,
          workWithUserIds: first.workWithUserIds,
          sfcRoutes: first.sfcRoutes,
          details: first.details,
          ...(first.sections?.length ? { sections: first.sections } : {}),
          days: month.days,
        },
      });
      return true;
    } catch (e) {
      Alert.alert('Could not send', tpMessage(e));
      return false;
    }
  }

  function openItem(id: string) {
    router.push({ pathname: '/tour-plan/form', params: { id } });
  }

  function onSelectDay(date: string) {
    setSelected(date);
  }

  function startTp() {
    const date = selected;
    const rank = { draft: 0, rejected: 1, pending: 2, approved: 3 } as const;
    const existing = date
      ? items
          .filter((t) => date >= t.from && date <= t.to)
          .sort((a, b) => rank[a.status] - rank[b.status])[0]
      : undefined;
    if (existing) {
      openItem(existing.id);
      return;
    }
    const from = date && !tpFutureMonthCutoffError(date) ? date : null;
    if (!from) {
      Alert.alert(
        'Tour plan closed',
        date
          ? (tpFutureMonthCutoffError(date) ?? 'Tour plans are only for the next month.')
          : 'Tour plans are only for the next month.',
      );
      return;
    }
    router.push(`/tour-plan/form?date=${from}`);
  }

  const dayNotPlannable = (date: string) =>
    !items.some((t) => date >= t.from && date <= t.to) && !!tpFutureMonthCutoffError(date);

  return (
    <TabScene>
      <View style={styles.flex}>
        <PullToRefresh onRefresh={() => q.refetch()}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: scrollPad }]}
          >
            {!CONTRACT.tpItems ? (
              <View style={styles.head}>
                <Chip label="Sample mode" tone="orange" />
              </View>
            ) : null}

            {q.isPending ? (
              <SkeletonList count={4} />
            ) : q.isError ? (
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">{saveMessage(q.error)}</AppText>
              </Card>
            ) : (
              <>
                <MonthCalendar
                  year={cursor.year}
                  monthIndex={cursor.monthIndex}
                  selected={selected}
                  pills={pills}
                  isDayDisabled={dayNotPlannable}
                  onSelectMonth={(year, monthIndex) => setCursor({ year, monthIndex })}
                  onSelectDay={onSelectDay}
                />
                <View style={styles.submit}>
                  <SlideToConfirm
                    label={`Submit (${rangeLabel(month.from, month.to)}) TP`}
                    doneLabel="Sent"
                    errorLabel="Could not send"
                    disabled={month.kind !== 'ready' || sendMonth.isPending}
                    onCommit={sendWholeMonth}
                  />
                  <AppText variant="small">
                    {month.kind === 'ready'
                      ? 'Send the whole month before this month ends. It closes after that.'
                      : month.kind === 'sent'
                        ? 'This month is already sent.'
                        : month.kind === 'split'
                          ? 'Part of this month is already sent, so the rest cannot join the same request.'
                          : `Still needed: ${month.dates
                              .slice(0, 3)
                              .map((d) => rangeLabel(d, d))
                              .join(', ')}${
                              month.dates.length > 3 ? ` and ${month.dates.length - 3} more` : ''
                            }.`}
                  </AppText>
                </View>
                {!items.length ? (
                  <Card style={styles.pad}>
                    <AppText variant="body">No tour plans yet</AppText>
                    <AppText variant="bodyMuted">
                      Tap a day, then Start TP. Approved days show as pills on the calendar.
                    </AppText>
                  </Card>
                ) : (
                  <View style={styles.lists}>
                    <StatusSections
                      approved={groups.approved}
                      pending={groups.pending}
                      rejected={groups.rejected}
                      drafts={groups.drafts}
                      labelOf={listLabelOf}
                      focusDate={selected}
                      onPickDate={(date) => {
                        setSelected(date);
                        const [y, m] = date.split('-').map(Number);
                        setCursor({ year: y!, monthIndex: m! - 1 });
                      }}
                      onOpen={openItem}
                    />
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </PullToRefresh>
        <FloatingFab
          label="Start TP"
          accessibilityLabel="Start tour plan for the selected day"
          tone="canopy"
          onPress={startTp}
        />
      </View>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: spacing.sm, gap: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
  },
  lists: { paddingHorizontal: layout.gutter },
  pad: { marginHorizontal: layout.gutter, padding: spacing.lg, gap: spacing.sm },
  submit: {
    marginHorizontal: layout.gutter,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
});
