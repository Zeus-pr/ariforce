import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { Card } from './card';
import { colors, layout, radius, sizes, spacing, touch } from '@/theme';

/**
 * Loading placeholders. The app never shows a spinner (ActivityIndicator is lint-banned): every
 * loading state draws grey shapes the size of what is coming, so nothing jumps when data lands.
 *
 * Pulse: a Reanimated CSS animation on opacity (UI thread, no JS ticks). Reduced motion: static.
 */
export const PULSE = {
  animationName: { '0%': { opacity: 1 }, '50%': { opacity: 0.45 }, '100%': { opacity: 1 } },
  animationDuration: 1200,
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
} as const;

export function Skeleton({
  width = '100%',
  height = 14,
  rounded = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: rounded, backgroundColor: colors.separator },
        reduced ? null : PULSE,
        style,
      ]}
    />
  );
}

/** Wraps a group of placeholders: one "Loading" for screen readers, children hidden from them. */
export function SkeletonGroup({
  children,
  style,
  label = 'Loading',
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  return (
    <View
      style={style}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      {children}
    </View>
  );
}

/** Same box as ListRow (sizes.row tall, icon tile, title + subtitle line). */
export function SkeletonRow({ divider, icon = true }: { divider?: boolean; icon?: boolean }) {
  return (
    <View style={[styles.row, divider && styles.divider]}>
      {icon ? (
        <Skeleton width={sizes.iconTile} height={sizes.iconTile} rounded={radius.md} />
      ) : null}
      <View style={styles.rowText}>
        <Skeleton width="62%" height={16} />
        <Skeleton width="40%" height={12} />
      </View>
    </View>
  );
}

/** A card of `count` list rows (masters lists, DCR drafts and history). */
export function SkeletonList({
  count = 6,
  icon = true,
  style,
}: {
  count?: number;
  icon?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SkeletonGroup>
      <Card style={style}>
        {Array.from({ length: count }, (_, i) => (
          <SkeletonRow key={i} icon={icon} divider={i < count - 1} />
        ))}
      </Card>
    </SkeletonGroup>
  );
}

/** Rows for a bottom-sheet picker (plain rows on the sheet ground, touch.control tall). */
export function SkeletonSheetRows({ count = 6 }: { count?: number }) {
  return (
    <SkeletonGroup>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.sheetRow}>
          <Skeleton width={`${70 - (i % 3) * 12}%`} height={16} />
          <Skeleton width="35%" height={12} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** Generic content card: a title line and a few text lines. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <SkeletonGroup>
      <Card style={styles.card}>
        <Skeleton width="50%" height={18} />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} />
        ))}
      </Card>
    </SkeletonGroup>
  );
}

/** Detail header card (masters detail): large icon tile, name, chip, two info lines. */
export function SkeletonDetailHeader() {
  return (
    <Card style={styles.card}>
      <Skeleton width={sizes.iconTileLg} height={sizes.iconTileLg} rounded={radius.lg} />
      <Skeleton width="70%" height={28} />
      <Skeleton width={96} height={24} rounded={radius.full} />
      <Skeleton width="85%" />
      <Skeleton width="60%" />
    </Card>
  );
}

/** One labelled form field (label line + touch.control box). */
export function SkeletonField() {
  return (
    <View style={styles.field}>
      <Skeleton width={110} height={14} />
      <Skeleton height={touch.control} rounded={radius.md} />
    </View>
  );
}

/** A form of `count` fields with the primary button at the bottom. */
export function SkeletonForm({ count = 5 }: { count?: number }) {
  return (
    <SkeletonGroup style={styles.form}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonField key={i} />
      ))}
      <Skeleton height={touch.control} rounded={radius.md} />
    </SkeletonGroup>
  );
}

/** KPI box (home KPI grid): label, big number, progress track. */
export function SkeletonKpi() {
  return (
    <Card style={[styles.card, styles.kpi]}>
      <Skeleton width="60%" height={13} />
      <Skeleton width="45%" height={26} />
      <Skeleton height={sizes.progress} rounded={radius.full} />
    </Card>
  );
}

/** Detail screen: header card plus a card of field rows. */
export function SkeletonDetail({ fields = 6 }: { fields?: number }) {
  return (
    <SkeletonGroup style={styles.form}>
      <SkeletonDetailHeader />
      <Card>
        {Array.from({ length: fields }, (_, i) => (
          <View key={i} style={[styles.detailField, i < fields - 1 && styles.divider]}>
            <Skeleton width={90} height={12} />
            <Skeleton width={`${75 - (i % 3) * 15}%`} height={16} />
          </View>
        ))}
      </Card>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: spacing.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  sheetRow: {
    minHeight: touch.control,
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  card: { padding: spacing.lg, gap: spacing.sm },
  kpi: { flex: 1 },
  field: { gap: spacing.sm },
  form: { gap: layout.inner },
  detailField: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs },
});
