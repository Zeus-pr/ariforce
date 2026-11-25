import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceDay } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { MonthPager } from '@/components/month-pager';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { useAuth } from '@/lib/auth-context';
import { dateLabel, todayIST } from '@/lib/dcr/dates';
import { listAttendanceDays, listTeamPeople } from '@/lib/field';
import { monthKey } from '@/lib/perf';
import { canViewTeamField, roleLabel, roleRank } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

const STATUS: Record<AttendanceDay['status'], { label: string; color: string }> = {
  present: { label: 'Present', color: colors.canopyDeep },
  incomplete: { label: 'No punch out', color: colors.warn },
  absent: { label: 'Absent', color: colors.danger },
  leave: { label: 'Leave', color: colors.muted },
  holiday: { label: 'Holiday', color: colors.muted },
};

function rangeOf(key: string) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

function clock(iso: string | undefined) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function weekKey(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function weekTitle(start: string) {
  const [y, m, d] = start.split('-').map(Number);
  const a = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const b = new Date(a);
  b.setUTCDate(a.getUTCDate() + 6);
  const end = b.toISOString().slice(0, 10);
  const today = todayIST();
  if (today >= start && today <= end) return 'This week';
  const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${fmt.format(a)} – ${fmt.format(b)}`;
}

function tally(days: AttendanceDay[]) {
  const c = { present: 0, incomplete: 0, absent: 0, leave: 0, holiday: 0 };
  for (const d of days) c[d.status] += 1;
  const parts = [
    c.present ? `${c.present} present` : null,
    c.incomplete ? `${c.incomplete} open` : null,
    c.leave ? `${c.leave} leave` : null,
    c.holiday ? `${c.holiday} holiday` : null,
    c.absent ? `${c.absent} absent` : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'Nothing recorded';
}

function byWeek(days: AttendanceDay[]) {
  const map = new Map<string, AttendanceDay[]>();
  for (const d of days) map.set(weekKey(d.date), [...(map.get(weekKey(d.date)) ?? []), d]);
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([start, rows]) => ({
      start,
      title: weekTitle(start),
      rows: [...rows].sort((a, b) => b.date.localeCompare(a.date)),
    }));
}

function Fold({
  title,
  detail,
  open,
  onPress,
  inset,
}: {
  title: string;
  detail?: string;
  open: boolean;
  onPress: () => void;
  inset?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={[styles.fold, inset && styles.inset]}
    >
      <View style={styles.copy}>
        <AppText variant="label" numberOfLines={1}>
          {title}
        </AppText>
        {detail ? <AppText variant="small">{detail}</AppText> : null}
      </View>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.subtle} />
    </Pressable>
  );
}

function Days({ days }: { days: AttendanceDay[] }) {
  return (
    <>
      {days.map((d) => {
        const tone = STATUS[d.status];
        const inn = clock(d.punchIn?.capturedAt);
        const out = clock(d.punchOut?.capturedAt);
        const times = [inn && `In ${inn}`, out && `Out ${out}`].filter(Boolean).join('  ·  ');
        return (
          <View key={d.date} style={[styles.day, styles.inset]}>
            <View style={styles.copy}>
              <AppText variant="label">{dateLabel(d.date)}</AppText>
              {times ? <AppText variant="small">{times}</AppText> : null}
              {d.visits > 0 ? (
                <AppText variant="small">
                  {d.visits} {d.visits === 1 ? 'visit' : 'visits'}
                </AppText>
              ) : null}
            </View>
            <AppText variant="label" style={{ color: tone.color }}>
              {tone.label}
            </AppText>
          </View>
        );
      })}
    </>
  );
}

function Weeks({
  days,
  openKey,
  onToggle,
}: {
  days: AttendanceDay[];
  openKey: string | null;
  onToggle: (key: string) => void;
}) {
  const weeks = byWeek(days);
  if (!weeks.length) {
    return (
      <View style={styles.pad}>
        <AppText variant="bodyMuted">Nothing recorded this month.</AppText>
      </View>
    );
  }
  return (
    <>
      {weeks.map((w) => {
        const open = openKey === w.start;
        return (
          <View key={w.start}>
            <Fold
              title={w.title}
              detail={tally(w.rows)}
              open={open}
              onPress={() => onToggle(w.start)}
              inset
            />
            {open ? <Days days={w.rows} /> : null}
          </View>
        );
      })}
    </>
  );
}

export default function AttendanceScreen() {
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const manager = canViewTeamField(user?.roles ?? []);
  const [month, setMonth] = useState(() => monthKey());
  const [youOpen, setYouOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState<string | null>(null);
  const [personOpen, setPersonOpen] = useState<string | null>(null);
  const [personWeek, setPersonWeek] = useState<string | null>(null);
  const { from, to } = rangeOf(month);

  const mine = useQuery({
    queryKey: ['attendance', 'person', user?.id, from, to],
    enabled: !!user?.id,
    queryFn: async () => {
      const days = await listAttendanceDays(from, to, user!.id);
      return days.filter((d) => d.userId === user!.id && d.date <= todayIST());
    },
  });

  const people = useQuery({
    queryKey: ['attendance', 'team'],
    enabled: manager,
    queryFn: listTeamPeople,
  });
  const others = (people.data ?? []).filter((p) => p.id !== user?.id);
  const roles = [...new Set(others.map((p) => roleLabel(p.roles)))].sort((a, b) => {
    const rank = (label: string) =>
      roleRank(others.find((p) => roleLabel(p.roles) === label)?.roles ?? []);
    return rank(b) - rank(a);
  });

  const teamDays = useQuery({
    queryKey: ['attendance', 'team-month', from, to],
    enabled: manager && teamOpen,
    queryFn: async () => {
      const days = await listAttendanceDays(from, to);
      return days.filter((d) => d.date <= todayIST());
    },
  });

  const mineDays = mine.data ?? [];
  const teamDetail = !manager
    ? ''
    : people.isPending
      ? 'Loading…'
      : people.isError
        ? 'Could not load your team'
        : others.length
          ? `${others.length} ${others.length === 1 ? 'person' : 'people'}`
          : 'No one reporting to you';

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Attendance' }} />
      <PullToRefresh
        onRefresh={() => Promise.all([mine.refetch(), people.refetch(), teamDays.refetch()])}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        >
          <MonthPager
            month={month}
            onChange={(next) => {
              setMonth(next);
              setWeekOpen(null);
              setPersonWeek(null);
            }}
          />

          <Card>
            <Fold
              title="You"
              detail={
                mine.isPending ? 'Loading…' : mine.isError ? 'Could not load' : tally(mineDays)
              }
              open={youOpen}
              onPress={() => setYouOpen((v) => !v)}
            />
            {youOpen ? (
              mine.isError ? (
                <View style={styles.pad}>
                  <AppText variant="bodyMuted">
                    Could not load attendance. Pull to try again.
                  </AppText>
                </View>
              ) : (
                <Weeks
                  days={mineDays}
                  openKey={weekOpen}
                  onToggle={(key) => setWeekOpen((cur) => (cur === key ? null : key))}
                />
              )
            ) : null}
          </Card>

          {manager ? (
            <Card>
              <Fold
                title="My team"
                detail={teamDetail}
                open={teamOpen}
                onPress={() => setTeamOpen((v) => !v)}
              />
              {teamOpen ? (
                people.isError ? (
                  <View style={styles.pad}>
                    <AppText variant="bodyMuted">
                      Could not load your team. Pull to try again.
                    </AppText>
                  </View>
                ) : !others.length ? (
                  <View style={styles.pad}>
                    <AppText variant="bodyMuted">No one is assigned to you yet.</AppText>
                  </View>
                ) : (
                  roles.map((role) => {
                    const members = others.filter((p) => roleLabel(p.roles) === role);
                    const open = roleOpen === role;
                    return (
                      <View key={role}>
                        <Fold
                          title={role}
                          detail={`${members.length}`}
                          open={open}
                          onPress={() => {
                            setRoleOpen((cur) => (cur === role ? null : role));
                            setPersonOpen(null);
                            setPersonWeek(null);
                          }}
                          inset
                        />
                        {open
                          ? members.map((p) => {
                              const days = (teamDays.data ?? []).filter((d) => d.userId === p.id);
                              const personOn = personOpen === p.id;
                              return (
                                <View key={p.id}>
                                  <Fold
                                    title={p.name}
                                    detail={
                                      teamDays.isPending
                                        ? 'Loading…'
                                        : teamDays.isError
                                          ? 'Could not load'
                                          : tally(days)
                                    }
                                    open={personOn}
                                    onPress={() => {
                                      setPersonOpen((cur) => (cur === p.id ? null : p.id));
                                      setPersonWeek(null);
                                    }}
                                    inset
                                  />
                                  {personOn && !teamDays.isPending && !teamDays.isError ? (
                                    <Weeks
                                      days={days}
                                      openKey={personWeek}
                                      onToggle={(key) =>
                                        setPersonWeek((cur) => (cur === key ? null : key))
                                      }
                                    />
                                  ) : null}
                                </View>
                              );
                            })
                          : null}
                      </View>
                    );
                  })
                )
              ) : null}
            </Card>
          ) : null}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg, gap: spacing.lg },
  fold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  inset: { paddingLeft: spacing.xl },
  copy: { flex: 1, gap: 2 },
  pad: { padding: spacing.lg },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
});
