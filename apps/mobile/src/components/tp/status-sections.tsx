import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Icon } from '../icon';
import { StatusPicker, useStatusKey } from '../status-picker';
import { WeekDeck } from '../week-deck';
import { rangeLabel, type TpItem } from '@/lib/tp/adapter';
import { onePress } from '@/lib/one-press';
import { colors, fonts, spacing } from '@/theme';

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <AppText variant="headline">{title}</AppText>
        <AppText variant="small">
          {count} {count === 1 ? 'Day' : 'Days'}
        </AppText>
      </View>
      {count ? children : <AppText variant="small">Nothing in this list.</AppText>}
    </View>
  );
}

function Row({
  item,
  subtitle,
  trailing,
  onPress,
  feedback,
  divider,
  resubmit,
}: {
  item: TpItem;
  subtitle: string;
  trailing?: string;
  onPress: () => void;
  feedback?: string | null;
  divider?: boolean;
  resubmit?: boolean;
}) {
  return (
    <Pressable
      onPress={onePress(onPress)}
      accessibilityRole="button"
      accessibilityLabel={`Tour plan ${rangeLabel(item.from, item.to)}`}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
    >
      <View style={styles.rowTop}>
        <AppText variant="chip" style={styles.date}>
          {rangeLabel(item.from, item.to).toUpperCase()}
        </AppText>
        {trailing ? (
          <AppText variant="small" style={styles.trailing}>
            {trailing}
          </AppText>
        ) : null}
      </View>
      <AppText variant="rowTitle">{subtitle}</AppText>
      {feedback ? (
        <View style={styles.feedback}>
          <AppText variant="chip" style={styles.feedbackLabel}>
            MANAGER FEEDBACK
          </AppText>
          <AppText variant="small" style={styles.feedbackBody}>
            {feedback}
          </AppText>
        </View>
      ) : null}
      {resubmit ? (
        <View style={styles.resubmit}>
          <AppText variant="action" style={styles.resubmitText}>
            Edit & Resubmit
          </AppText>
          <Icon name="arrow-right" size={14} color={colors.canopy} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Approved / Pending / Rejected / Drafts lists under the month calendar. */
export function StatusSections({
  approved,
  pending,
  rejected,
  drafts,
  labelOf,
  onOpen,
  focusDate,
  onPickDate,
}: {
  approved: TpItem[];
  pending: TpItem[];
  rejected: TpItem[];
  drafts: TpItem[];
  labelOf: (t: TpItem) => string;
  onOpen: (id: string) => void;
  focusDate?: string | null;
  onPickDate?: (date: string) => void;
}) {
  const { live, value, setChosen } = useStatusKey(
    [
      { key: 'drafts', label: 'Draft', count: drafts.length },
      { key: 'approved', label: 'Approved', count: approved.length },
      { key: 'rejected', label: 'Rejected', count: rejected.length },
      { key: 'pending', label: 'Pending', count: pending.length },
    ],
    true,
  );

  return (
    <View style={styles.wrap}>
      <StatusPicker options={live} value={value} onChange={setChosen} />
      {value === 'approved' ? (
        <Section title="Approved Tour Plans" count={approved.length}>
          <WeekDeck
            items={approved}
            dateOf={(t) => t.from}
            focusDate={focusDate}
            onPickDate={onPickDate}
            renderItem={(t, i, count) => (
              <Row
                item={t}
                subtitle={labelOf(t)}
                trailing={t.userName || undefined}
                onPress={() => onOpen(t.id)}
                divider={i < count - 1}
              />
            )}
          />
        </Section>
      ) : null}
      {value === 'pending' ? (
        <Section title="Pending Approval" count={pending.length}>
          <WeekDeck
            items={pending}
            dateOf={(t) => t.from}
            focusDate={focusDate}
            onPickDate={onPickDate}
            renderItem={(t, i, count) => (
              <Row
                item={t}
                subtitle={labelOf(t)}
                trailing={t.submittedAt ? 'Awaiting Sign-off' : 'In Review'}
                onPress={() => onOpen(t.id)}
                divider={i < count - 1}
              />
            )}
          />
        </Section>
      ) : null}
      {value === 'rejected' ? (
        <Section title="Rejected / Needs Resubmission" count={rejected.length}>
          <WeekDeck
            items={rejected}
            dateOf={(t) => t.from}
            focusDate={focusDate}
            onPickDate={onPickDate}
            renderItem={(t, i, count) => (
              <Row
                item={t}
                subtitle={labelOf(t)}
                onPress={() => onOpen(t.id)}
                feedback={t.rejectionReason}
                resubmit
                divider={i < count - 1}
              />
            )}
          />
        </Section>
      ) : null}
      {value === 'drafts' ? (
        <Section title="Drafts" count={drafts.length}>
          <WeekDeck
            items={drafts}
            dateOf={(t) => t.from}
            focusDate={focusDate}
            onPickDate={onPickDate}
            renderItem={(t, i, count) => (
              <Row
                item={t}
                subtitle={labelOf(t)}
                trailing="Not submitted"
                onPress={() => onOpen(t.id)}
                divider={i < count - 1}
              />
            )}
          />
        </Section>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, paddingTop: spacing.sm },
  section: { gap: spacing.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  row: { padding: spacing.md, gap: 4 },
  pressed: { backgroundColor: colors.ground },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  date: {
    color: colors.muted,
    fontFamily: fonts.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  trailing: { color: colors.subtle },
  feedback: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.ground,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 6,
    gap: 2,
  },
  feedbackLabel: { color: colors.muted, fontFamily: fonts.bold },
  feedbackBody: { color: colors.muted },
  resubmit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  resubmitText: { color: colors.canopy, fontFamily: fonts.semibold },
});
