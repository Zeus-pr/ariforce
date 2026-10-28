import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { SectionHeader } from '@/components/section-header';
import { useAuth } from '@/lib/auth-context';
import { FEATURES, featureHref, type FeatureKey } from '@/lib/features';
import { isApprover, roleLabel } from '@/lib/roles';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { colors, layout, spacing } from '@/theme';

/** Account, the features without a tab, and Sign out. */
export default function MoreTab() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const bottom = useBottomSpace();

  const roles = user?.roles ?? [];
  const name = user?.name?.trim() || user?.email || 'Your account';
  const links: FeatureKey[] = [
    'attendance',
    'leave',
    'expenses',
    ...(isApprover(roles) ? (['approvals'] as const) : []),
    'notifications',
  ];

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
  }

  return (
    <TabScene>
      <ScrollView
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
      >
        <View style={styles.profile} accessible accessibilityRole="summary">
          <Avatar name={name} large />
          <View style={styles.profileText}>
            <AppText variant="headline" numberOfLines={2}>
              {name}
            </AppText>
            <AppText variant="caption" numberOfLines={1}>
              {roleLabel(roles)}
            </AppText>
          </View>
        </View>

        <Card>
          <ListRow title="Email" subtitle={user?.email ?? '—'} divider />
          <ListRow title="Company" subtitle={user?.companyName ?? '—'} divider />
          <ListRow title="Role" subtitle={roleLabel(roles)} />
        </Card>

        <View style={styles.section}>
          <SectionHeader title="Work" />
          <Card>
            {links.map((key, i) => {
              const f = FEATURES[key];
              return (
                <ListRow
                  key={key}
                  icon={f.icon}
                  tone={f.tone}
                  title={f.title}
                  subtitle={f.short}
                  onPress={() => router.push(featureHref(key))}
                  divider={i < links.length - 1}
                />
              );
            })}
          </Card>
        </View>

        <View style={styles.section}>
          <Button
            label="Sign out"
            loadingLabel="Signing out…"
            variant="secondary"
            loading={signingOut}
            onPress={onSignOut}
          />
          <AppText variant="small" style={styles.version}>
            AriForce {Constants.expoConfig?.version ?? ''} · preview
          </AppText>
        </View>
      </ScrollView>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingBottom: layout.section,
  },
  profileText: { flex: 1 },
  section: { marginTop: layout.section },
  version: { textAlign: 'center', marginTop: spacing.lg },
});
