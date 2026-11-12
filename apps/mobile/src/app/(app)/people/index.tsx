import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { UserSummary } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { roleLabel } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

const STATUS: Record<UserSummary['status'], string> = {
  invited: 'Invited',
  active: 'Active',
  suspended: 'Suspended',
  pending: 'Pending',
  rejected: 'Rejected',
};

export default function PeopleScreen() {
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const allowed = (user?.roles ?? []).includes('system_admin');
  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);
  const list = useQuery({
    queryKey: ['people', q],
    enabled: allowed,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<{ items: UserSummary[]; nextCursor?: string | null }>('/v1/users', {
        query: { limit: 100, sort: 'name', ...(q ? { q } : {}) },
      }),
  });
  if (!allowed) return <Redirect href="/" />;
  const rows = list.data?.items ?? [];

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'People' }} />
      <PullToRefresh onRefresh={() => list.refetch()}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
          <TextField
            label="Search"
            value={draft}
            onChangeText={setDraft}
            placeholder="Name or employee code"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {list.isPending ? (
            <SkeletonList count={6} />
          ) : list.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Could not load people. Pull to try again.</AppText>
            </Card>
          ) : !rows.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">
                {q ? 'No one matches that search.' : 'No people in this company yet.'}
              </AppText>
            </Card>
          ) : (
            <Card>
              {rows.map((p, i) => (
                <View key={p.id} style={[styles.row, i < rows.length - 1 && styles.divider]}>
                  <AppText variant="label" numberOfLines={1}>
                    {p.name}
                  </AppText>
                  <AppText variant="small" numberOfLines={2}>
                    {roleLabel(p.roles)} · {STATUS[p.status]}
                    {p.territories?.[0] ? ` · ${p.territories[0].name}` : ''}
                    {p.managerName ? ` · reports to ${p.managerName}` : ''}
                  </AppText>
                </View>
              ))}
              {list.data?.nextCursor ? (
                <View style={styles.pad}>
                  <AppText variant="small">
                    Showing the first 100. Search to narrow the list.
                  </AppText>
                </View>
              ) : null}
            </Card>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg, gap: spacing.lg },
  pad: { padding: spacing.lg },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
});
