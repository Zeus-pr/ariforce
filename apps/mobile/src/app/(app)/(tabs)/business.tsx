import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { FEATURES, featureHref, type FeatureKey } from '@/lib/features';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { colors, layout, spacing } from '@/theme';

const LISTS = ['doctors', 'chemists', 'stockists'] as const satisfies readonly FeatureKey[];

/** Stub: the three customer lists a rep calls on. Each opens "Coming soon". */
export default function BusinessTab() {
  const router = useRouter();
  const bottom = useBottomSpace();
  return (
    <ScrollView
      style={styles.flex}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
    >
      <Card>
        {LISTS.map((key, i) => {
          const f = FEATURES[key];
          return (
            <ListRow
              key={key}
              icon={f.icon}
              tone={f.tone}
              title={f.title}
              subtitle={f.short}
              onPress={() => router.push(featureHref(key))}
              divider={i < LISTS.length - 1}
            />
          );
        })}
      </Card>
      <AppText variant="small" style={styles.note}>
        Customer lists are coming to the app. Use the AriForce website for them today.
      </AppText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: layout.inner },
  note: { paddingHorizontal: layout.gutter },
});
