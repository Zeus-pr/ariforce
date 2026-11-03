import type { Dcr } from '@ariforce/contracts';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Card } from '../card';
import { Chip } from '../chip';
import { Icon } from '../icon';
import { dateLabel } from '@/lib/dcr/dates';
import { REVIEW_LABEL, REVIEW_TONE, type Review } from '@/lib/dcr/adapter';
import { rangeLabel, type TpDraftCard } from '@/lib/tp/adapter';
import { colors, fonts, spacing } from '@/theme';

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <AppText variant="headline">{title}</AppText>
        <AppText variant="small">
          {count} {count === 1 ? 'Day' : 'Days'}
        </AppText>
      </View>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

function DcrRow({
  d,
  subtitle,
  review,
  onPress,
  trailing,
  divider,
  onDelete,
}: {
  d: Dcr;
  subtitle: string;
  review?: Review;
  onPress: () => void;
  trailing?: ReactNode;
  divider?: boolean;
  onDelete?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`DCR ${dateLabel(d.date)}`}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
    >
      <View style={styles.rowTop}>
        <AppText variant="chip" style={styles.date}>
          {dateLabel(d.date).toUpperCase()}
        </AppText>
        {trailing ??
          (review ? (
            <Chip label={REVIEW_LABEL[review.status]} tone={REVIEW_TONE[review.status]} />
          ) : null)}
      </View>
      <AppText variant="rowTitle">{subtitle}</AppText>
      {review?.status === 'rejected' && review.reason ? (
        <View style={styles.feedback}>
          <AppText variant="chip" style={styles.feedbackLabel}>
            MANAGER FEEDBACK
          </AppText>
          <AppText variant="small" style={styles.feedbackBody}>
            {review.reason}
          </AppText>
        </View>
      ) : null}
      {onDelete ? (
        <Pressable
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete draft for ${dateLabel(d.date)}`}
          hitSlop={8}
          style={styles.delete}
        >
          <Icon name="trash-can-outline" size={18} color={colors.danger} />
          <AppText variant="action" style={styles.deleteText}>
            Delete draft
          </AppText>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** Approved / Pending / Rejected / Drafts / Drafts from TP under the DCR calendar. */
export function DcrStatusSections({
  approved,
  pending,
  rejected,
  drafts,
  tpCards,
  labelOf,
  tpLabelOf,
  onOpenDcr,
  onOpenTp,
  onDeleteDraft,
}: {
  approved: { d: Dcr; review: Review }[];
  pending: { d: Dcr; review: Review }[];
  rejected: { d: Dcr; review: Review }[];
  drafts: { d: Dcr; review: Review }[];
  tpCards: TpDraftCard[];
  labelOf: (d: Dcr) => string;
  tpLabelOf: (t: TpDraftCard) => string;
  onOpenDcr: (d: Dcr) => void;
  onOpenTp: (t: TpDraftCard) => void;
  onDeleteDraft: (d: Dcr) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Section title="Approved" count={approved.length}>
        {approved.map(({ d, review }, i) => (
          <DcrRow
            key={d.id}
            d={d}
            review={review}
            subtitle={labelOf(d)}
            onPress={() => onOpenDcr(d)}
            divider={i < approved.length - 1}
          />
        ))}
      </Section>
      <Section title="Pending" count={pending.length}>
        {pending.map(({ d, review }, i) => (
          <DcrRow
            key={d.id}
            d={d}
            review={review}
            subtitle={labelOf(d)}
            onPress={() => onOpenDcr(d)}
            divider={i < pending.length - 1}
          />
        ))}
      </Section>
      <Section title="Rejected" count={rejected.length}>
        {rejected.map(({ d, review }, i) => (
          <DcrRow
            key={d.id}
            d={d}
            review={review}
            subtitle={labelOf(d)}
            onPress={() => onOpenDcr(d)}
            divider={i < rejected.length - 1}
          />
        ))}
      </Section>
      <Section title="Drafts" count={drafts.length}>
        {drafts.map(({ d, review }, i) => (
          <DcrRow
            key={d.id}
            d={d}
            review={review}
            subtitle={labelOf(d)}
            onPress={() => onOpenDcr(d)}
            onDelete={() => onDeleteDraft(d)}
            divider={i < drafts.length - 1}
          />
        ))}
      </Section>
      <Section title="Drafts from TP" count={tpCards.length}>
        {tpCards.map((t, i) => (
          <Pressable
            key={t.id}
            onPress={() => onOpenTp(t)}
            accessibilityRole="button"
            accessibilityLabel={`Tour plan draft ${rangeLabel(t.from, t.to)}`}
            style={({ pressed }) => [
              styles.row,
              i < tpCards.length - 1 && styles.divider,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.rowTop}>
              <AppText variant="chip" style={styles.date}>
                {rangeLabel(t.from, t.to).toUpperCase()}
              </AppText>
              <Chip label="Approved plan" tone="green" />
            </View>
            <AppText variant="rowTitle">{tpLabelOf(t)}</AppText>
            <AppText variant="small" style={styles.trailing}>
              {t.pendingDates.length === 1
                ? `${dateLabel(t.pendingDates[0]!)} to file`
                : `${t.pendingDates.length} days to file · pick a day`}
            </AppText>
          </Pressable>
        ))}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xl, paddingTop: spacing.lg },
  section: { gap: spacing.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  card: { paddingVertical: 0, overflow: 'hidden' },
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
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  deleteText: { color: colors.danger, fontFamily: fonts.semibold },
});
