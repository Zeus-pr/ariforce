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
import { MonthCalendar } from '@/components/tp/month-calendar';
import { StatusSections } from '@/components/tp/status-sections';
import { useAuth } from '@/lib/auth-context';
import { useDcrOptions, useDcrTerritories } from '@/lib/dcr/api';
import { todayIST } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { normaliseWorkTypes, territoryRows } from '@/lib/dcr/model';
import { isSalesRole } from '@/lib/roles';
import {
  CONTRACT,
  tpDefaultFromDate,
  tpFutureMonthCutoffError,
  useMyTps,
  type TpItem,
} from '@/lib/tp/adapter';
import { groupByStatus, pillsByDate, tpListLabel, tpPillLabel } from '@/lib/tp/calendar';
import { layout, spacing } from '@/theme';

/** Tour plans: Stitch month calendar + status lists, New TP FAB. */
export default function TourPlanTab() {
  const { user } = useAuth();
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  return <TourPlans myId={user?.id} />;
}

function TourPlans({ myId }: { myId?: string }) {
  const router = useRouter();
  const scrollPad = useFabScrollPad();
  const q = useMyTps(myId);
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
  const pillLabelOf = useMemo(() => (t: TpItem) => tpPillLabel(t, names), [names]);
  const listLabelOf = useMemo(() => (t: TpItem) => tpListLabel(t, names), [names]);

  const pills = useMemo(() => pillsByDate(items, pillLabelOf), [items, pillLabelOf]);
  const groups = useMemo(() => groupByStatus(items), [items]);

  function openItem(id: string) {
    router.push({ pathname: '/tour-plan/form', params: { id } });
  }

  function onSelectDay(date: string, dayPills: { itemId: string }[]) {
    setSelected(date);
    if (dayPills.length === 1) openItem(dayPills[0]!.itemId);
    else if (!dayPills.length) {
      if (tpFutureMonthCutoffError(date)) return;
      router.push({ pathname: '/tour-plan/form', params: { date } });
    }
  }

  const dayNotPlannable = (date: string) => !!tpFutureMonthCutoffError(date);

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
                {!items.length ? (
                  <Card style={styles.pad}>
                    <AppText variant="body">No tour plans yet</AppText>
                    <AppText variant="bodyMuted">
                      Plan a day with New TP, then send it to your manager. Approved days show as
                      pills on the calendar.
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
                      onOpen={openItem}
                    />
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </PullToRefresh>
        <FloatingFab
          label="New TP"
          accessibilityLabel="New tour plan"
          tone="canopy"
          onPress={() => {
            const from = tpDefaultFromDate();
            if (!from) {
              Alert.alert(
                'Tour plan closed',
                'Tour plans are only for the next month, and that window closed after the 22nd at 12:10 AM IST.',
              );
              return;
            }
            router.push(`/tour-plan/form?date=${from}`);
          }}
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
});
