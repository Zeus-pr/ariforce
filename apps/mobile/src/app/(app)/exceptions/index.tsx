import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ExceptionItem, ExceptionSummary } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { dateLabel } from '@/lib/dcr/dates';
import { isSalesRole } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

function titleOf(code: string) {
  return code
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export default function ExceptionsScreen() {
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const [open, setOpen] = useState<string | null>(null);
  const summary = useQuery({
    queryKey: ['exceptions', 'summary'],
    enabled: isSalesRole(user?.roles ?? []),
    staleTime: 60_000,
    queryFn: () => apiFetch<ExceptionSummary>('/v1/exceptions/summary'),
  });
  const items = useQuery({
    queryKey: ['exceptions', 'rule', open],
    enabled: !!open,
    queryFn: () =>
      apiFetch<{ items: ExceptionItem[] }>('/v1/exceptions', {
        query: { status: 'open', ruleCode: open!, limit: 50 },
      }).then((r) => r.items ?? []),
  });
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  const rules = (summary.data?.byRule ?? []).filter((r) => r.open > 0);

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Exceptions' }} />
      <PullToRefresh onRefresh={() => Promise.all([summary.refetch(), items.refetch()])}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
          {summary.isPending ? (
            <SkeletonList count={3} />
          ) : summary.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Could not load exceptions. Pull to try again.</AppText>
            </Card>
          ) : (
            <Card>
              <View style={styles.head}>
                <AppText variant="label">Open</AppText>
                <AppText variant="section">{summary.data?.open ?? 0}</AppText>
              </View>
              {!rules.length ? (
                <View style={styles.pad}>
                  <AppText variant="bodyMuted">Nothing open in the last 30 days.</AppText>
                </View>
              ) : (
                rules.map((rule) => {
                  const on = open === rule.ruleCode;
                  return (
                    <View key={rule.ruleCode}>
                      <Pressable
                        onPress={() => setOpen((c) => (c === rule.ruleCode ? null : rule.ruleCode))}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: on }}
                        style={styles.row}
                      >
                        <View style={styles.copy}>
                          <AppText variant="label">{titleOf(rule.ruleCode)}</AppText>
                          <AppText variant="small">
                            {rule.open} open · {rule.severity}
                          </AppText>
                        </View>
                        <Icon
                          name={on ? 'chevron-up' : 'chevron-down'}
                          size={20}
                          color={colors.subtle}
                        />
                      </Pressable>
                      {on ? (
                        items.isPending ? (
                          <View style={styles.pad}>
                            <AppText variant="bodyMuted">Loading…</AppText>
                          </View>
                        ) : items.isError ? (
                          <View style={styles.pad}>
                            <AppText variant="bodyMuted">Could not load these.</AppText>
                          </View>
                        ) : (
                          (items.data ?? []).map((item) => (
                            <View key={item.id} style={styles.item}>
                              <AppText variant="label">{item.user?.name ?? 'Someone'}</AppText>
                              <AppText variant="small">
                                {dateLabel(item.periodDate)}
                                {item.value != null ? ` · ${item.value}` : ''}
                              </AppText>
                              <AppText variant="small">{item.suggestedAction}</AppText>
                            </View>
                          ))
                        )
                      ) : null}
                    </View>
                  );
                })
              )}
            </Card>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg },
  pad: { padding: spacing.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  copy: { flex: 1, gap: 2 },
  item: {
    paddingLeft: spacing.xl,
    paddingRight: spacing.lg,
    paddingBottom: spacing.md,
    gap: 2,
  },
});
