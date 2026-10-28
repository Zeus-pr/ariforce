import { ScrollView, StyleSheet, View } from 'react-native';
import { useBottomSpace } from './floating-tab-bar';
import { AppText } from './app-text';
import { Chip } from './chip';
import { TintedIcon } from './tinted-icon';
import { FEATURES, type FeatureKey } from '@/lib/features';
import { colors, layout, spacing } from '@/theme';

/** Stub for a feature that is on the website but not in the app yet. */
export function ComingSoon({ feature }: { feature: FeatureKey }) {
  const f = FEATURES[feature];
  const bottom = useBottomSpace();
  return (
    <ScrollView
      style={styles.flex}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
    >
      <View style={styles.body}>
        <TintedIcon name={f.icon} tone={f.tone} large />
        <AppText variant="title" accessibilityRole="header" style={styles.center}>
          {f.title}
        </AppText>
        <AppText variant="bodyMuted" style={styles.center}>
          {f.blurb}
        </AppText>
        <Chip label="Coming soon to the app" tone="teal" />
        <AppText variant="caption" style={styles.center}>
          Use the AriForce website for this today.
        </AppText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  // Same gutter as every screen; centred in the space above the tab bar.
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.gutter,
    paddingTop: layout.section,
  },
  body: { alignItems: 'center', gap: spacing.md },
  center: { textAlign: 'center' },
});
