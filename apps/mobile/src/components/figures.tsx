import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from '@/components/app-text';
import type { CallSlice, DayMark, GapBar, RankBar } from '@/lib/figures';
import { colors, motion, spacing } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const DRAW = 560;

const RING = 148;
const STROKE = 12;

/** A single arc. The percent sits in the middle. */
export function Ring({
  percent,
  title,
  caption,
  compact = false,
}: {
  percent: number | null;
  title: string;
  caption?: string;
  /** Two rings share one card on Sales. */
  compact?: boolean;
}) {
  const reduced = useReducedMotion();
  const size = compact ? 118 : RING;
  const stroke = compact ? 10 : STROKE;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = reduced ? pct : withTiming(pct, { duration: DRAW, easing: motion.easeOut });
  }, [pct, reduced, sweep]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: c - (sweep.value / 100) * c }));
  const label = percent == null ? '—' : `${Math.round(percent)}%`;
  return (
    <View
      style={styles.ringWrap}
      accessibilityRole="image"
      accessibilityLabel={`${title} ${label}${caption ? `, ${caption}` : ''}`}
    >
      <View style={[styles.ringBox, { width: size, height: size }]}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.separator}
            strokeWidth={stroke}
            fill="none"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.tealDeep}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${c} ${c}`}
            animatedProps={arc}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={styles.ringLabel} pointerEvents="none">
          <AppText variant={compact ? 'kpi' : 'title'}>{label}</AppText>
        </View>
      </View>
      <AppText variant="label">{title}</AppText>
      {caption ? <AppText variant="small">{caption}</AppText> : null}
    </View>
  );
}

/** A bar that grows from the left to its share of the row. */
export function GrowBar({
  share,
  lead = false,
  index = 0,
}: {
  share: number;
  lead?: boolean;
  index?: number;
}) {
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    const to = Math.max(0, Math.min(1, share));
    v.value = reduced
      ? to
      : withDelay(
          Math.min(index, 8) * 40,
          withTiming(to, { duration: DRAW, easing: motion.easeOut }),
        );
  }, [share, reduced, index, v]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: v.value }] }));
  return (
    <Animated.View style={[styles.rankFill, lead ? styles.rankLead : styles.rankWash, style]} />
  );
}

function GrowColumn({
  share,
  current,
  index,
  tone = 'teal',
}: {
  share: number;
  current: boolean;
  index: number;
  tone?: 'teal' | 'navy';
}) {
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    const to = Math.max(0.08, Math.min(1, share));
    v.value = reduced
      ? to
      : withDelay(index * 50, withTiming(to, { duration: DRAW, easing: motion.easeOut }));
  }, [share, reduced, index, v]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: v.value }] }));
  const fill =
    tone === 'navy'
      ? current
        ? styles.columnNavy
        : styles.columnNavyPast
      : current
        ? styles.columnNow
        : styles.columnPast;
  return <Animated.View style={[styles.columnFill, fill, style]} />;
}

function GrowCapsule({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = reduced ? 1 : withTiming(1, { duration: DRAW, easing: motion.easeOut });
  }, [reduced, v]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: v.value }] }));
  return <Animated.View style={[styles.capsule, style]}>{children}</Animated.View>;
}

function PopDot({ mark, index, label }: { mark: DayMark; index: number; label: string }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    v.value = reduced
      ? 1
      : withDelay(
          Math.min(index, 24) * 16,
          withTiming(1, { duration: motion.fast, easing: motion.easeOut }),
        );
  }, [reduced, index, v]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.6 + v.value * 0.4 }],
  }));
  return <Animated.View accessibilityLabel={label} style={[styles.dot, MARK[mark], style]} />;
}

/** Ranked rows. The bar sits behind the name. Percent is out of 100. */
export function RankRows({ rows }: { rows: RankBar[] }) {
  return (
    <View>
      {rows.map((row, index) => (
        <View key={row.id} style={styles.rank}>
          <GrowBar share={row.share} lead={row.lead} index={index} />
          <View style={styles.rankName}>
            <AppText variant="label" numberOfLines={1}>
              {row.label}
            </AppText>
            {row.note ? <AppText variant="small">{row.note}</AppText> : null}
          </View>
          <AppText variant="label">{row.text}</AppText>
        </View>
      ))}
    </View>
  );
}

/** Six rounded columns. The latest month is teal. */
export function MonthColumns({
  columns,
  paired = false,
}: {
  columns: {
    key: string;
    label: string;
    text: string;
    share: number;
    current: boolean;
    pairShare?: number;
  }[];
  /** Primary beside secondary. Primary is navy, secondary is teal. */
  paired?: boolean;
}) {
  return (
    <View style={styles.columns}>
      {columns.map((col, index) => (
        <View key={col.key} style={styles.column}>
          <View style={styles.columnTrack}>
            {paired ? (
              <View style={styles.pair}>
                <View style={styles.pairSlot}>
                  <GrowColumn
                    share={col.pairShare ?? 0}
                    current={col.current}
                    index={index}
                    tone="navy"
                  />
                </View>
                <View style={styles.pairSlot}>
                  <GrowColumn share={col.share} current={col.current} index={index} />
                </View>
              </View>
            ) : (
              <GrowColumn share={col.share} current={col.current} index={index} />
            )}
          </View>
          <AppText variant="small">{col.label}</AppText>
          {paired ? null : (
            <AppText variant="small" numberOfLines={1}>
              {col.text}
            </AppText>
          )}
        </View>
      ))}
    </View>
  );
}

const SLICE_COLOR = {
  doctor: colors.tealDeep,
  chemist: colors.brandTeal,
  stockist: colors.navy,
} as const;

const SLICE_NAME = { doctor: 'Doctors', chemist: 'Chemists', stockist: 'Stockists' } as const;

/** One capsule split by call kind, with the counts written underneath. */
export function CallCapsule({
  slices,
  samples,
  orders,
  quiet,
}: {
  slices: CallSlice[];
  samples: number;
  orders: number;
  quiet: number;
}) {
  const total = slices.reduce((n, s) => n + s.count, 0);
  if (!total) {
    return <AppText variant="small">No calls recorded this month.</AppText>;
  }
  return (
    <View style={styles.mix}>
      <GrowCapsule>
        {slices.map((s) =>
          s.count ? (
            <View
              key={s.kind}
              style={{ flex: s.count, backgroundColor: SLICE_COLOR[s.kind], minWidth: 8 }}
            />
          ) : null,
        )}
      </GrowCapsule>
      <AppText variant="small">
        {slices.map((s) => `${SLICE_NAME[s.kind]} ${s.count}`).join('  ·  ')}
      </AppText>
      <AppText variant="small">
        {samples} sample lines · {orders} order lines
        {quiet ? ` · ${quiet} with neither` : ''}
      </AppText>
    </View>
  );
}

const MARK = {
  filed: { backgroundColor: colors.tealDeep },
  open: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.borderStrong },
  rest: { backgroundColor: 'transparent' },
  ahead: { backgroundColor: colors.separator },
} as const;

/** Days of the month. A filled dot has a submitted DCR. Sunday is blank. */
export function DayStrip({ days }: { days: { day: string; mark: DayMark }[] }) {
  return (
    <View style={styles.stripWrap}>
      <View style={styles.strip}>
        {days.map((d, index) => (
          <PopDot key={d.day} mark={d.mark} index={index} label={`${d.day} ${d.mark}`} />
        ))}
      </View>
      <AppText variant="small">A filled day has a submitted DCR. Sunday is blank.</AppText>
    </View>
  );
}

export function GapRows({ rows, labelOf }: { rows: GapBar[]; labelOf: (kpi: string) => string }) {
  if (!rows.length) return null;
  return (
    <View>
      {rows.map((row, index) => (
        <View key={row.id} style={styles.rank}>
          <GrowBar share={row.share} index={index} />
          <View style={styles.rankName}>
            <AppText variant="label" numberOfLines={1}>
              {row.name}
            </AppText>
            <AppText variant="small">{labelOf(row.label)}</AppText>
          </View>
          <AppText variant="label">{row.text}</AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ringWrap: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  ringBox: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringLabel: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  rank: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
  rankFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    transformOrigin: 'left center',
  },
  rankLead: { backgroundColor: colors.tealSoft },
  rankWash: { backgroundColor: colors.tealWash },
  rankName: { flex: 1, gap: 2 },
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  column: { flex: 1, alignItems: 'center', gap: spacing.xs },
  columnTrack: {
    height: 96,
    width: '70%',
    justifyContent: 'flex-end',
  },
  columnFill: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    transformOrigin: 'center bottom',
  },
  columnNow: { backgroundColor: colors.tealDeep },
  columnPast: { backgroundColor: colors.tealWash },
  columnNavy: { backgroundColor: colors.navy },
  columnNavyPast: { backgroundColor: colors.brandNavyWash },
  pair: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: '100%' },
  pairSlot: { flex: 1, height: '100%' },
  mix: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  capsule: {
    height: 18,
    width: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: colors.separator,
    transformOrigin: 'left center',
  },
  stripWrap: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
