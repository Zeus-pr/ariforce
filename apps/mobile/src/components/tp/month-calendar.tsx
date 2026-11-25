import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Icon } from '../icon';
import { monthGrid, type DayPill } from '@/lib/tp/calendar';
import type { CalendarPillStatus } from '@/lib/calendar-pills';
import { monthName } from '@/lib/format';
import { colors, fonts, layout, radius, spacing, touch } from '@/theme';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** Event chips keep the original solid colours. */
function pillStyle(status: CalendarPillStatus) {
  switch (status) {
    case 'approved':
      return { bg: colors.canopy, fg: colors.onNavy, border: colors.canopy };
    case 'pending':
      return { bg: '#0284C7', fg: colors.onNavy, border: '#0284C7' };
    case 'rejected':
      return { bg: colors.dangerWash, fg: colors.danger, border: colors.danger };
    case 'tp':
      return { bg: colors.tealWash, fg: colors.tealInk, border: colors.tealSoft };
    case 'draft':
    default:
      return { bg: colors.navy, fg: colors.onNavy, border: colors.navy };
  }
}

/**
 * Whole date-box wash (not the pill): rejected red, pending transparent,
 * approved subtle green — priority rejected > pending > approved.
 */
function cellWash(status: CalendarPillStatus | null): string | undefined {
  switch (status) {
    case 'rejected':
      return 'rgba(180, 35, 24, 0.12)';
    case 'pending':
      return 'transparent';
    case 'approved':
      return 'rgba(21, 128, 61, 0.14)';
    default:
      return undefined;
  }
}

function dominantStatus(pills: DayPill[]): CalendarPillStatus | null {
  if (!pills.length) return null;
  if (pills.some((p) => p.status === 'rejected')) return 'rejected';
  if (pills.some((p) => p.status === 'pending')) return 'pending';
  if (pills.some((p) => p.status === 'approved')) return 'approved';
  return pills[0]?.status ?? null;
}

/** Outlook/Teams-style month grid: short plan labels inside each day cell. */
export function MonthCalendar({
  year,
  monthIndex,
  selected,
  pills,
  onSelectMonth,
  onSelectDay,
  isDayDisabled,
}: {
  year: number;
  monthIndex: number;
  selected: string | null;
  pills: Map<string, DayPill[]>;
  onSelectMonth: (year: number, monthIndex: number) => void;
  onSelectDay: (date: string, pills: DayPill[]) => void;
  /** Grey out / block empty days (e.g. TP: current month not plannable). Days with pills stay tappable. */
  isDayDisabled?: (date: string) => boolean;
}) {
  const cells = monthGrid(year, monthIndex);
  const title = `${monthName(new Date(year, monthIndex, 1))} ${year}`;

  function prev() {
    if (monthIndex === 0) onSelectMonth(year - 1, 11);
    else onSelectMonth(year, monthIndex - 1);
  }
  function next() {
    if (monthIndex === 11) onSelectMonth(year + 1, 0);
    else onSelectMonth(year, monthIndex + 1);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.monthBar}>
        <AppText variant="section" style={styles.monthTitle}>
          {title}
        </AppText>
        <View style={styles.nav}>
          <Pressable
            onPress={prev}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            style={styles.navBtn}
          >
            <Icon name="chevron-left" color={colors.muted} />
          </Pressable>
          <Pressable
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            style={styles.navBtn}
          >
            <Icon name="chevron-right" color={colors.muted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d) => (
          <AppText key={d} variant="chip" style={styles.weekday}>
            {d}
          </AppText>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((date, idx) => {
          if (!date) {
            return <View key={`pad-${idx}`} style={styles.cell} />;
          }
          const dayPills = pills.get(date) ?? [];
          const dayNum = Number(date.slice(8, 10));
          const isSelected = selected === date;
          const isSun = idx % 7 === 0;
          const wash = cellWash(dominantStatus(dayPills));
          const disabled = !!isDayDisabled?.(date) && dayPills.length === 0;
          return (
            <Pressable
              key={date}
              onPress={disabled ? undefined : () => onSelectDay(date, dayPills)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              accessibilityLabel={`${date}${dayPills.length ? `, ${dayPills.length} plans` : ''}${disabled ? ', not available to plan' : ''}`}
              style={[
                styles.cell,
                isSun && !wash && !disabled && styles.cellMuted,
                wash != null ? { backgroundColor: wash } : null,
                disabled && styles.cellDisabled,
              ]}
            >
              <View style={[styles.dayNum, isSelected && !disabled && styles.dayNumOn]}>
                <AppText
                  variant="chip"
                  style={[
                    styles.dayText,
                    isSelected && !disabled && styles.dayTextOn,
                    disabled && styles.dayTextDisabled,
                  ]}
                >
                  {dayNum}
                </AppText>
              </View>
              <View style={styles.pills}>
                {dayPills.slice(0, 3).map((p, i) => {
                  const look = pillStyle(p.status);
                  return (
                    <View
                      key={`${p.itemId}-${p.date}-${i}`}
                      style={[
                        styles.pill,
                        {
                          backgroundColor: look.bg,
                          borderColor: look.border,
                        },
                      ]}
                    >
                      <AppText
                        variant="chip"
                        numberOfLines={1}
                        style={[styles.pillText, { color: look.fg }]}
                      >
                        {p.label}
                      </AppText>
                    </View>
                  );
                })}
                {dayPills.length > 3 ? (
                  <AppText variant="chip" style={styles.more}>
                    +{dayPills.length - 3}
                  </AppText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.sm,
    backgroundColor: colors.ground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  monthTitle: { fontSize: 16, fontFamily: fonts.bold },
  nav: { flexDirection: 'row', gap: spacing.xs },
  navBtn: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    color: colors.subtle,
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: '#DADCE0',
  },
  cell: {
    width: '14.2857%',
    minHeight: 96,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#DADCE0',
    padding: 3,
    alignItems: 'stretch',
  },
  cellMuted: { backgroundColor: 'rgba(248,250,252,0.8)' },
  cellDisabled: { backgroundColor: 'rgba(148,163,184,0.16)' },
  dayNum: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    alignSelf: 'center',
  },
  dayNumOn: { backgroundColor: colors.canopy },
  dayText: { color: colors.navy, fontFamily: fonts.semibold, fontSize: 11 },
  dayTextOn: { color: colors.onNavy },
  dayTextDisabled: { color: colors.subtle },
  pills: { width: '100%', gap: 2 },
  pill: {
    borderRadius: 3,
    borderWidth: 1,
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
  pillText: { fontSize: 8.5, lineHeight: 10, fontFamily: fonts.medium },
  more: {
    fontSize: 8,
    color: colors.subtle,
    fontFamily: fonts.semibold,
    textAlign: 'center',
  },
});
