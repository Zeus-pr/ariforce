import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Card } from '../card';
import { SkeletonList } from '../skeleton';
import type { Attention } from '@/lib/home-attention';
import { colors, fonts, radius, spacing } from '@/theme';

/** Stitch "Needs Attention" rows with compact CTA. */
export function AttentionList({ items, pending }: { items: Attention[]; pending: boolean }) {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText variant="chip" style={styles.section}>
          NEEDS ATTENTION
        </AppText>
        {!pending ? (
          <AppText variant="small" style={styles.count}>
            ({items.length})
          </AppText>
        ) : null}
      </View>
      {pending ? (
        <SkeletonList count={2} />
      ) : !items.length ? (
        <Card style={styles.empty}>
          <AppText variant="bodyMuted">You’re all caught up.</AppText>
        </Card>
      ) : (
        <Card style={styles.card}>
          {items.map((item, i) => (
            <View key={item.id} style={[styles.row, i < items.length - 1 && styles.divider]}>
              <View style={styles.copy}>
                <AppText variant="chip" style={styles.eyebrow} numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="small" style={styles.detail} numberOfLines={2}>
                  {item.detail}
                </AppText>
              </View>
              <Pressable
                onPress={() => router.push(item.href)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.title}`}
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              >
                <AppText variant="chip" style={styles.ctaText}>
                  Review
                </AppText>
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  section: {
    color: colors.subtle,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
  },
  count: { color: colors.muted, fontFamily: fonts.semibold },
  empty: { padding: spacing.lg },
  card: { paddingVertical: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { color: colors.ink, fontFamily: fonts.bold, textTransform: 'uppercase' },
  detail: { color: colors.muted },
  cta: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.ground,
    marginTop: 2,
  },
  ctaPressed: { backgroundColor: colors.separator },
  ctaText: { color: colors.ink, fontFamily: fonts.semibold },
});
