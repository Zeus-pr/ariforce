import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleKey } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/lib/auth-context';
import { ApiError, apiFetch } from '@/lib/api';
import { canViewTeamField, roleLabel } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

type RequestRow = {
  id: string;
  name: string;
  email: string;
  requestedRole: RoleKey;
  status: string;
};

export default function SignupsScreen() {
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const allowed = canViewTeamField(user?.roles ?? []);
  const q = useQuery({
    queryKey: ['signups', 'pending'],
    enabled: allowed,
    queryFn: () =>
      apiFetch<{ items: RequestRow[] }>('/v1/signup-requests', {
        query: { status: 'pending' },
      }).then((r) => r.items ?? []),
  });
  const decide = useMutation({
    mutationFn: async (input: { id: string; decision: 'approve' | 'reject'; role?: RoleKey }) => {
      if (input.decision === 'approve') {
        return apiFetch(`/v1/signup-requests/${input.id}/approve`, {
          method: 'POST',
          body: { role: input.role },
        });
      }
      return apiFetch(`/v1/signup-requests/${input.id}/reject`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
    },
    onSuccess: async () => {
      setReason('');
      setError(null);
      setOpen(null);
      await qc.invalidateQueries({ queryKey: ['signups'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save that decision.'),
  });
  if (!allowed) return <Redirect href="/" />;
  const rows = q.data ?? [];

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Sign-up requests' }} />
      <PullToRefresh onRefresh={() => q.refetch()}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
          {q.isPending ? (
            <SkeletonList count={3} />
          ) : q.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Could not load requests. Pull to try again.</AppText>
            </Card>
          ) : !rows.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">No one is waiting for approval.</AppText>
            </Card>
          ) : (
            <Card>
              {rows.map((r) => {
                const on = open === r.id;
                return (
                  <View key={r.id}>
                    <Pressable
                      onPress={() => {
                        setOpen((id) => (id === r.id ? null : r.id));
                        setError(null);
                        setReason('');
                      }}
                      accessibilityRole="button"
                      style={styles.row}
                    >
                      <View style={styles.copy}>
                        <AppText variant="label" numberOfLines={1}>
                          {r.name}
                        </AppText>
                        <AppText variant="small">
                          {roleLabel([r.requestedRole])} · {r.email}
                        </AppText>
                      </View>
                      <Icon
                        name={on ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={colors.subtle}
                      />
                    </Pressable>
                    {on ? (
                      <View style={styles.detail}>
                        <Button
                          label="Approve"
                          compact
                          loading={decide.isPending}
                          onPress={() =>
                            decide.mutate({ id: r.id, decision: 'approve', role: r.requestedRole })
                          }
                        />
                        <TextField
                          label="Reason if you reject"
                          value={reason}
                          onChangeText={setReason}
                          maxLength={500}
                        />
                        <Button
                          label="Reject"
                          variant="secondary"
                          compact
                          disabled={!reason.trim() || decide.isPending}
                          onPress={() => decide.mutate({ id: r.id, decision: 'reject' })}
                        />
                        {error ? (
                          <AppText variant="small" style={styles.error}>
                            {error}
                          </AppText>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  copy: { flex: 1, gap: 2 },
  detail: { padding: spacing.lg, gap: spacing.md },
  error: { color: colors.danger },
});
