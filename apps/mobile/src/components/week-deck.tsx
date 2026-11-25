import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { Card } from './card';
import { Icon } from './icon';
import { MonthCalendar } from './tp/month-calendar';
import { todayIST } from '@/lib/dcr/dates';
import { colors, spacing } from '@/theme';

type Week<T> = { start: string; end: string; items: T[] };

const dayMonth = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
});

function shift(ymd: string, days: number) {
  const date = new Date(`${ymd}T12:00:00+05:30`);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Sunday that starts the IST week, matching the calendar's Sunday-first grid. */
function weekStart(ymd: string) {
  const date = new Date(`${ymd}T12:00:00+05:30`);
  return shift(ymd, -date.getUTCDay());
}

function weekLabel(start: string, end: string) {
  const a = new Date(`${start}T12:00:00+05:30`);
  const b = new Date(`${end}T12:00:00+05:30`);
  const today = todayIST();
  if (today >= start && today <= end) return 'This week';
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${dayMonth.format(b)}`;
  return `${dayMonth.format(a)} – ${dayMonth.format(b)}`;
}

function groupWeeks<T>(items: T[], dateOf: (item: T) => string): Week<T>[] {
  const byStart = new Map<string, T[]>();
  for (const item of items) {
    const start = weekStart(dateOf(item));
    const list = byStart.get(start);
    if (list) list.push(item);
    else byStart.set(start, [item]);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, grouped]) => ({
      start,
      end: shift(start, 6),
      items: [...grouped].sort((a, b) => dateOf(a).localeCompare(dateOf(b))),
    }));
}

function weekIndex<T>(weeks: Week<T>[], focus: string) {
  const hit = weeks.findIndex((week) => focus >= week.start && focus <= week.end);
  if (hit >= 0) return hit;
  let latest = -1;
  weeks.forEach((week, index) => {
    if (week.start <= focus) latest = index;
  });
  return latest >= 0 ? latest : Math.max(0, weeks.length - 1);
}

/**
 * One week of a status list, drawn in the page scroll. Arrows move to the next week
 * that has items. There is no scroller of its own, so the page keeps scrolling.
 */
export function WeekDeck<T>({
  items,
  dateOf,
  focusDate,
  onPickDate,
  renderItem,
}: {
  items: T[];
  dateOf: (item: T) => string;
  focusDate?: string | null;
  onPickDate?: (date: string) => void;
  renderItem: (item: T, index: number, count: number) => ReactNode;
}) {
  const weekKey = items.map(dateOf).join('|');
  const weeks = useMemo(() => groupWeeks(items, dateOf), [weekKey, items, dateOf]);
  const [page, setPage] = useState(() => weekIndex(weeks, focusDate || todayIST()));
  const [calOpen, setCalOpen] = useState(false);
  const focus = focusDate || todayIST();
  const [cal, setCal] = useState(() => {
    const [y, m] = focus.split('-').map(Number);
    return { year: y!, monthIndex: m! - 1 };
  });
  const placeKey = `${focusDate ?? ''}|${weeks.map((week) => week.start).join(',')}`;

  // placeKey already folds the week starts and the focused day.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPage(weekIndex(weeks, focusDate || todayIST()));
  }, [placeKey]);

  if (!weeks.length) return null;
  const current = weeks[Math.min(page, weeks.length - 1)]!;

  function go(next: number) {
    setPage(Math.max(0, Math.min(weeks.length - 1, next)));
  }

  return (
    <View style={styles.deck}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => go(page - 1)}
          disabled={page <= 0}
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          hitSlop={8}
          style={[styles.step, page <= 0 && styles.stepOff]}
        >
          <Icon name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => setCalOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Choose a date"
          style={styles.title}
        >
          <AppText variant="section" numberOfLines={1}>
            {weekLabel(current.start, current.end)}
          </AppText>
          <AppText variant="small">
            {current.items.length} {current.items.length === 1 ? 'day' : 'days'}
            {weeks.length > 1 ? ` · ${page + 1} of ${weeks.length}` : ''}
          </AppText>
        </Pressable>
        <Pressable
          onPress={() => go(page + 1)}
          disabled={page >= weeks.length - 1}
          accessibilityRole="button"
          accessibilityLabel="Next week"
          hitSlop={8}
          style={[styles.step, page >= weeks.length - 1 && styles.stepOff]}
        >
          <Icon name="chevron-right" size={22} color={colors.ink} />
        </Pressable>
      </View>
      <Card style={styles.card}>
        {current.items.map((item, index) => (
          <Fragment key={`${dateOf(item)}-${index}`}>
            {renderItem(item, index, current.items.length)}
          </Fragment>
        ))}
      </Card>
      <Modal visible={calOpen} transparent animationType="fade" onRequestClose={() => setCalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCalOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <MonthCalendar
              year={cal.year}
              monthIndex={cal.monthIndex}
              selected={focus}
              pills={new Map()}
              onSelectMonth={(year, monthIndex) => setCal({ year, monthIndex })}
              onSelectDay={(date) => {
                setCalOpen(false);
                onPickDate?.(date);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { gap: spacing.sm },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepOff: { opacity: 0.28 },
  title: { flex: 1, alignItems: 'center', gap: 2 },
  card: { paddingVertical: 0, overflow: 'hidden' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 42, 74, 0.4)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
  },
});
