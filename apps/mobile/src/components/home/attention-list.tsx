import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { cardStyles } from '../card';
import { PressableScale } from '../pressable-scale';
import { SkeletonList } from '../skeleton';
import type { Attention } from '@/lib/home-attention';
import { colors, fonts, spacing } from '@/theme';

const VISIBLE = 6;

type Tile = {
  id: string;
  label: string;
  count: number;
  detail: string;
  href: Attention['href'];
};

const BUCKETS: {
  id: string;
  label: string;
  many: Attention['href'];
  take: (item: Attention) => boolean;
}[] = [
  {
    id: 'dcr',
    label: 'DCRs',
    many: '/dcr',
    take: (item) => item.id.startsWith('dcr-') || item.title.startsWith('DCR'),
  },
  {
    id: 'tp',
    label: 'Tour plans',
    many: '/tour-plan',
    take: (item) => item.id.startsWith('tp-') || item.title.startsWith('Tour plan'),
  },
  {
    id: 'exp',
    label: 'Expenses',
    many: '/expenses',
    take: (item) => item.id.startsWith('exp-'),
  },
  {
    id: 'unlock',
    label: 'Unlocks',
    many: '/approvals',
    take: (item) => item.id === 'unlock',
  },
];

/** One tile per kind of work. Approvals stay on the Waiting for you card. */
function tilesOf(items: Attention[]): Tile[] {
  const used = new Set<string>();
  const tiles: Tile[] = [];
  for (const bucket of BUCKETS) {
    const rows = items.filter((item) => bucket.take(item));
    if (!rows.length) continue;
    rows.forEach((row) => used.add(row.id));
    const top = rows[0]!;
    tiles.push({
      id: bucket.id,
      label: bucket.label,
      count: rows.length,
      detail: rows.length === 1 ? top.detail : top.title,
      href: rows.length === 1 ? top.href : bucket.many,
    });
  }
  return tiles;
}

/** Needs attention as a short grid. More than six opens the rest in place. */
export function AttentionList({ items, pending }: { items: Attention[]; pending: boolean }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const tiles = tilesOf(items);
  const visible = showAll ? tiles : tiles.slice(0, VISIBLE);
  const more = tiles.length - VISIBLE;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText variant="chip" style={styles.section}>
          NEEDS ATTENTION
        </AppText>
        {more > 0 ? (
          <Pressable
            onPress={() => setShowAll((v) => !v)}
            accessibilityRole="button"
            hitSlop={spacing.md}
          >
            <AppText variant="label" style={styles.more}>
              {showAll ? 'Show less' : 'View all'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {pending ? (
        <SkeletonList count={2} />
      ) : !tiles.length ? (
        <View style={[cardStyles.card, styles.empty]}>
          <AppText variant="bodyMuted">You’re all caught up.</AppText>
        </View>
      ) : (
        <View style={styles.grid}>
          {visible.map((tile) => (
            <PressableScale
              key={tile.id}
              onPress={() => router.push(tile.href)}
              accessibilityLabel={`${tile.count} ${tile.label}. ${tile.detail}`}
              containerStyle={styles.cell}
              style={[cardStyles.card, styles.tile]}
              pressedStyle={styles.pressed}
              scaleTo={0.98}
            >
              <AppText variant="count">{tile.count}</AppText>
              <AppText variant="label" numberOfLines={1}>
                {tile.label}
              </AppText>
              <AppText variant="small" numberOfLines={2}>
                {tile.detail}
              </AppText>
            </PressableScale>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  section: {
    color: colors.subtle,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
  },
  more: { color: colors.tealDeep },
  empty: { padding: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { flexGrow: 1, flexBasis: '46%' },
  tile: { padding: spacing.lg, gap: 2, minHeight: 108 },
  pressed: { backgroundColor: colors.ground },
});
