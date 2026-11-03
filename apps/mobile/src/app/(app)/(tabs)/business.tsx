import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { ScrollView } from '@/components/scroll';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { FEATURES, featureHref, type FeatureKey } from '@/lib/features';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { colors, layout, spacing } from '@/theme';

const LISTS = ['doctors', 'chemists', 'stockists', 'products'] as const satisfies readonly FeatureKey[];

/** Customer and product lists a rep uses in the field. */
export default function BusinessTab() {
  const router = useRouter();
  const bottom = useBottomSpace();
  return (
    <TabScene>
      <ScrollView
        style={styles.flex}
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
      </ScrollView>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: layout.inner },
});
