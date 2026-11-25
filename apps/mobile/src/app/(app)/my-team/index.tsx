import { Redirect, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { TeamNode, TeamTree } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { isApprover, roleLabel } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

const STATUS: Record<TeamNode['status'], string | null> = {
  invited: 'Invited',
  active: null,
  suspended: 'Suspended',
};

function line(n: TeamNode) {
  const bits = [n.role ? roleLabel([n.role]) : 'No role'];
  const place = n.territories[0]?.name;
  if (place) bits.push(place);
  const status = STATUS[n.status];
  if (status) bits.push(status);
  return bits.join(' · ');
}

function Branch({
  nodes,
  parentId,
  open,
  onToggle,
  depth,
}: {
  nodes: TeamNode[];
  parentId: string;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  depth: number;
}) {
  const kids = nodes
    .filter((n) => n.managerId === parentId && n.depth >= 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  return kids.map((n) => {
    const hasKids = n.directReportCount > 0;
    const on = open.has(n.id);
    return (
      <View key={n.id}>
        <Pressable
          onPress={hasKids ? () => onToggle(n.id) : undefined}
          accessibilityRole={hasKids ? 'button' : 'text'}
          style={[styles.row, { paddingLeft: spacing.lg + depth * spacing.md }]}
        >
          <View style={styles.copy}>
            <AppText variant="label" numberOfLines={1}>
              {n.name}
            </AppText>
            <AppText variant="small" numberOfLines={1}>
              {line(n)}
              {hasKids ? ` · ${n.directReportCount} reporting` : ''}
            </AppText>
          </View>
          {hasKids ? (
            <Icon name={on ? 'chevron-up' : 'chevron-down'} size={20} color={colors.subtle} />
          ) : null}
        </Pressable>
        {on ? (
          <Branch nodes={nodes} parentId={n.id} open={open} onToggle={onToggle} depth={depth + 1} />
        ) : null}
      </View>
    );
  });
}

export default function MyTeamScreen() {
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const allowed = isApprover(user?.roles ?? []);
  const q = useQuery({
    queryKey: ['my-team'],
    enabled: allowed,
    staleTime: 60_000,
    queryFn: () => apiFetch<TeamTree>('/v1/team'),
  });
  const reports = useMemo(
    () => (q.data ? q.data.nodes.filter((n) => n.id !== q.data.rootId && n.depth >= 0) : []),
    [q.data],
  );
  if (!allowed) return <Redirect href="/" />;

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'My team' }} />
      <PullToRefresh onRefresh={() => q.refetch()}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
          {q.isPending ? (
            <SkeletonList count={5} />
          ) : q.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Could not load your team. Pull to try again.</AppText>
            </Card>
          ) : (
            <>
              <Card>
                {reports.length ? (
                  <Branch
                    nodes={q.data?.nodes ?? []}
                    parentId={q.data?.rootId ?? ''}
                    open={open}
                    onToggle={toggle}
                    depth={0}
                  />
                ) : (
                  <View style={styles.pad}>
                    <AppText variant="bodyMuted">No one reports to you yet.</AppText>
                  </View>
                )}
              </Card>
              {q.data?.unassigned?.length ? (
                <Card>
                  <Pressable
                    onPress={() => setUnassignedOpen((v) => !v)}
                    accessibilityRole="button"
                    style={styles.row}
                  >
                    <View style={styles.copy}>
                      <AppText variant="label">Unassigned</AppText>
                      <AppText variant="small">
                        {q.data.unassigned.length} without a manager
                      </AppText>
                    </View>
                    <Icon
                      name={unassignedOpen ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={colors.subtle}
                    />
                  </Pressable>
                  {unassignedOpen
                    ? q.data.unassigned.map((n) => (
                        <View key={n.id} style={[styles.row, styles.nested]}>
                          <View style={styles.copy}>
                            <AppText variant="label" numberOfLines={1}>
                              {n.name}
                            </AppText>
                            <AppText variant="small" numberOfLines={1}>
                              {line(n)}
                            </AppText>
                          </View>
                        </View>
                      ))
                    : null}
                </Card>
              ) : null}
            </>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  nested: { paddingLeft: spacing.xl },
  copy: { flex: 1, gap: 2 },
});
