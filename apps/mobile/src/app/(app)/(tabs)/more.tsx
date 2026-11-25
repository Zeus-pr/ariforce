import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScrollView } from '@/components/scroll';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { SectionHeader } from '@/components/section-header';
import { useAuth } from '@/lib/auth-context';
import { FEATURES, featureHref, type FeatureKey } from '@/lib/features';
import { canViewTeamField, isApprover, isSalesRole, roleLabel } from '@/lib/roles';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { layout, spacing } from '@/theme';

/** Account, the features without a tab, and Sign out. */
export default function MoreTab() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const bottom = useBottomSpace();

  const roles = user?.roles ?? [];
  const name = user?.name?.trim() || user?.email || 'Your account';
  const links: FeatureKey[] = [
    ...(canViewTeamField(roles) ? (['teamField'] as const) : []),
    'attendance',
    'leave',
    'expenses',
    ...(isApprover(roles) ? (['approvals'] as const) : []),
    'notifications',
    ...(roles.includes('director') || roles.includes('system_admin')
      ? (['companyMessage'] as const)
      : []),
  ];
  const performance: FeatureKey[] = [
    ...(isSalesRole(roles) ? (['sales', 'coverage', 'reports'] as const) : []),
    ...(isApprover(roles) ? (['team'] as const) : []),
  ];
  const watch: FeatureKey[] = [
    ...(isSalesRole(roles) ? (['exceptions', 'expenseReports'] as const) : []),
    ...(!isSalesRole(roles) && roles.includes('system_admin') ? (['expenseReports'] as const) : []),
    ...(canViewTeamField(roles) ? (['sfc', 'signups'] as const) : []),
  ];
  const directory: FeatureKey[] = [
    ...(isApprover(roles) ? (['myTeam'] as const) : []),
    ...(roles.includes('system_admin') ? (['people'] as const) : []),
  ];

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
  }

  return (
    <TabScene>
      <ScrollView
        style={styles.flex}
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

        {[
          ['Performance', performance],
          ['Watch', watch],
          ['Directory', directory],
        ].map(([title, keys]) =>
          (keys as FeatureKey[]).length ? (
            <View key={title as string} style={styles.section}>
              <SectionHeader title={title as string} />
              <Card>
                {(keys as FeatureKey[]).map((key, i, all) => {
                  const f = FEATURES[key];
                  return (
                    <ListRow
                      key={key}
                      icon={f.icon}
                      tone={f.tone}
                      title={f.title}
                      subtitle={f.short}
                      onPress={() => router.push(featureHref(key))}
                      divider={i < all.length - 1}
                    />
                  );
                })}
              </Card>
            </View>
          ) : null,
        )}

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
  // Transparent so the tab watermark (TabScene) shows; the scene paints colors.ground.
  flex: { flex: 1 },
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
