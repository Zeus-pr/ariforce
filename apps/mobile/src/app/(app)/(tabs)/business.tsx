import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { ScrollView } from '@/components/scroll';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { useAuth } from '@/lib/auth-context';
import { FEATURES, featureHref, type FeatureKey } from '@/lib/features';
import { canManageOutletLocks } from '@/lib/roles';
import { colors, fonts, layout, radius, spacing, tones } from '@/theme';

const LISTS = [
  'doctors',
  'chemists',
  'stockists',
  'products',
] as const satisfies readonly FeatureKey[];

/** Customer and product lists — full-bleed 2×2 masters, not a lonely card of rows. */
export default function BusinessTab() {
  const router = useRouter();
  const bottom = useBottomSpace();
  const { user } = useAuth();
  const manager = canManageOutletLocks(user?.roles ?? []);

  return (
    <TabScene>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
      >
        <AppText variant="bodyMuted" style={styles.lead}>
          Doctors, chemists, stockists and products for your territories.
        </AppText>

        <View style={styles.grid}>
          {LISTS.map((key) => {
            const f = FEATURES[key];
            const tone = tones[f.tone];
            return (
              <PressableScale
                key={key}
                onPress={() => router.push(featureHref(key))}
                accessibilityLabel={`${f.title}. ${f.short}`}
                containerStyle={styles.cell}
                style={styles.tile}
                pressedStyle={styles.tilePressed}
                scaleTo={0.97}
              >
                <View style={[styles.iconWash, { backgroundColor: tone.bg }]}>
                  <Icon name={f.icon} size={28} color={tone.fg} />
                </View>
                <View style={styles.tileCopy}>
                  <AppText variant="label" numberOfLines={1}>
                    {f.title}
                  </AppText>
                  <AppText variant="small" style={styles.tileShort} numberOfLines={2}>
                    {f.short}
                  </AppText>
                </View>
                <Icon name="chevron-right" size={20} color={colors.subtle} />
              </PressableScale>
            );
          })}
        </View>

        {manager ? (
          <View style={styles.note}>
            <View style={styles.noteIcon}>
              <Icon name="map-marker-radius-outline" size={20} color={colors.canopyDeep} />
            </View>
            <AppText variant="small" style={styles.noteText}>
              Open a doctor, chemist or stockist to review locked GPS pins and fix a wrong lock.
            </AppText>
          </View>
        ) : (
          <View style={styles.note}>
            <View style={styles.noteIcon}>
              <Icon name="information-outline" size={20} color={colors.muted} />
            </View>
            <AppText variant="small" style={styles.noteText}>
              Lists follow your territory scope. Search inside each list to find a record.
            </AppText>
          </View>
        )}
      </ScrollView>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  // Transparent so the tab watermark (TabScene) shows; the scene paints colors.ground.
  flex: { flex: 1 },
  content: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  lead: { paddingHorizontal: spacing.xs },
  grid: { gap: spacing.md },
  cell: { alignSelf: 'stretch' },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    minHeight: 88,
  },
  tilePressed: { backgroundColor: colors.ground },
  iconWash: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileCopy: { flex: 1, gap: 2 },
  tileShort: { color: colors.muted },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.tealWash,
  },
  noteIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteText: { flex: 1, color: colors.tealInk, fontFamily: fonts.medium, lineHeight: 20 },
});
