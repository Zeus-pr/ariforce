import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { DecisionBar } from '@/components/approvals/decision-bar';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { TintedIcon } from '@/components/tinted-icon';
import type { IconName } from '@/components/icon';
import { motion, spacing, type Tone } from '@/theme';

/** One pending approval: who, type, summary, view details, approve / reject. */
export function ApprovalInboxCard({
  icon,
  tone,
  who,
  typeLabel,
  typeTone,
  summary,
  meta,
  what,
  busy,
  error,
  approveBlocked,
  onDecide,
  onDetails,
  expandOnDetails,
  detailsLabel = 'View details',
  index = 0,
}: {
  icon: IconName;
  tone: Tone;
  who: string;
  typeLabel: string;
  typeTone: Tone;
  /** One line under the name (date, amount, range, etc.). */
  summary: string;
  meta?: ReactNode;
  what: string;
  busy: boolean;
  error?: string | null;
  approveBlocked?: string | null;
  onDecide: (decision: 'approve' | 'reject', reason: string | null) => void;
  /** Navigate to a detail screen. Ignored when expandOnDetails is set. */
  onDetails?: () => void;
  /** In-card expand instead of navigation (e.g. leave with no detail route). */
  expandOnDetails?: ReactNode;
  detailsLabel?: string;
  /** Stagger list enter animation (capped). */
  index?: number;
}) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const enter =
    reduced ? undefined : FadeIn.duration(motion.fast).delay(Math.min(index, 10) * 36);
  const canExpand = expandOnDetails != null;
  const detailsAction = () => {
    if (canExpand) setExpanded((o) => !o);
    else onDetails?.();
  };
  const detailsText =
    canExpand && expanded ? 'Hide details' : detailsLabel;

  return (
    <Animated.View entering={enter}>
      <Card style={styles.card}>
        <View style={styles.head}>
          <TintedIcon name={icon} tone={tone} />
          <View style={styles.copy}>
            <View style={styles.titleRow}>
              <AppText variant="label" style={styles.who} numberOfLines={1}>
                {who}
              </AppText>
              <Chip label={typeLabel} tone={typeTone} />
            </View>
            <AppText variant="bodyMuted" numberOfLines={2}>
              {summary}
            </AppText>
            {meta ? <View style={styles.meta}>{meta}</View> : null}
            {expanded && expandOnDetails ? (
              <View style={styles.expand}>{expandOnDetails}</View>
            ) : null}
          </View>
        </View>
        {canExpand || onDetails ? (
          <Button label={detailsText} variant="tint" compact onPress={detailsAction} />
        ) : null}
        <DecisionBar
          what={what}
          busy={busy}
          error={error}
          approveBlocked={approveBlocked}
          onDecide={onDecide}
        />
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  who: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  expand: { marginTop: spacing.xs, gap: spacing.xs },
});
