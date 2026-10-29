import type { Dcr } from '@ariforce/contracts';
import { Redirect, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { useDeleteDraft, useDraftList, useDcrOptions, useSubmittedHistory } from '@/lib/dcr/api';
import { dateLabel, savedLabel, todayIST } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { BANDS, normaliseWorkTypes } from '@/lib/dcr/model';
import { useAuth } from '@/lib/auth-context';
import { isSalesRole } from '@/lib/roles';
import { colors, layout, radius, shadows, spacing, touch } from '@/theme';

/**
 * DCR workspace (web dcr-workspace.tsx): saved drafts, New DCR, and submitted history.
 * Opening a card pushes the form stack screen.
 */
export default function DcrTab() {
  const { user } = useAuth();
  // DCR is for the sales ladder only (web nav.ts SALES); the tab is hidden for others too.
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  return <DcrWorkspace />;
}

function DcrWorkspace() {
  const router = useRouter();
  const bottom = useBottomSpace();
  const today = todayIST();
  const draftsQ = useDraftList();
  const historyQ = useSubmittedHistory();
  const optionsQ = useDcrOptions(today);
  const remove = useDeleteDraft();
  const [busyId, setBusyId] = useState<string | null>(null);

  const workTypeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of normaliseWorkTypes(optionsQ.data?.workTypes ?? [])) map.set(w.id, w.name);
    return map;
  }, [optionsQ.data]);

  const submittedDays = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of historyQ.data?.items ?? []) if (d.status === 'submitted') m.set(d.date, d.id);
    return m;
  }, [historyQ.data]);

  const drafts = useMemo(
    () => (draftsQ.data?.items ?? []).filter((d) => d.status === 'draft'),
    [draftsQ.data],
  );
  const history = useMemo(
    () => (historyQ.data?.items ?? []).filter((d) => d.status === 'submitted'),
    [historyQ.data],
  );

  const refreshing =
    (draftsQ.isRefetching || historyQ.isRefetching) && !draftsQ.isPending && !historyQ.isPending;

  const refresh = () => {
    void draftsQ.refetch();
    void historyQ.refetch();
    void optionsQ.refetch();
  };

  const openForm = (params: { id?: string; date?: string; new?: string }) =>
    router.push({ pathname: '/dcr/form', params });

  const confirmDelete = (d: Dcr) => {
    Alert.alert(
      'Delete this draft?',
      `The draft for ${dateLabel(d.date)}${workTypeName.get(d.workTypeId) ? ` (${workTypeName.get(d.workTypeId)})` : ''} and its calls will be deleted. This can’t be undone.`,
      [
        { text: 'Keep draft', style: 'cancel' },
        {
          text: 'Delete draft',
          style: 'destructive',
          onPress: () => {
            setBusyId(d.id);
            remove.mutate(d.id, {
              onSettled: () => setBusyId(null),
              onError: (e) => Alert.alert('Could not delete', saveMessage(e)),
            });
          },
        },
      ],
    );
  };

  const subtitle = (d: Dcr) => {
    const band = BANDS.find((b) => b.band === d.band);
    const what =
      workTypeName.get(d.workTypeId) ??
      (band
        ? 'Field work'
        : d.details?.kind
          ? d.details.kind[0]!.toUpperCase() + d.details.kind.slice(1)
          : 'Report');
    const n = d.callCount ?? d.calls?.length ?? 0;
    const territory = d.territoryIds.length
      ? `${d.territoryIds.length} ${d.territoryIds.length === 1 ? 'territory' : 'territories'}`
      : null;
    return [what, band?.label, territory, band || n ? `${n} call${n === 1 ? '' : 's'}` : null]
      .filter(Boolean)
      .join(' · ');
  };

  const listError = draftsQ.isError
    ? saveMessage(draftsQ.error)
    : historyQ.isError
      ? saveMessage(historyQ.error)
      : null;

  return (
    <TabScene>
      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: bottom + touch.control + spacing.lg },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.navy}
              colors={[colors.navy]}
            />
          }
        >
          <View style={styles.headRow}>
            <AppText variant="small">
              {draftsQ.isPending
                ? 'Saved drafts'
                : drafts.length
                  ? `Saved drafts (${drafts.length})`
                  : 'No saved drafts'}
            </AppText>
          </View>

          {listError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{listError}</AppText>
              <Pressable onPress={refresh} accessibilityRole="button" style={styles.retry}>
                <Icon name="refresh" color={colors.navy} />
                <AppText variant="action">Retry</AppText>
              </Pressable>
            </Card>
          ) : null}

          {draftsQ.isPending ? (
            <SkeletonList count={2} />
          ) : !drafts.length ? (
            <Card style={styles.pad}>
              <AppText variant="body">No saved drafts</AppText>
              <AppText variant="bodyMuted">
                Start today’s report with New DCR. Save it as a draft to come back later.
              </AppText>
            </Card>
          ) : (
            <Card>
              {drafts.map((d, i) => (
                <ListRow
                  key={d.id}
                  icon="clipboard-text-outline"
                  tone="teal"
                  title={dateLabel(d.date)}
                  subtitle={`${subtitle(d)} · Saved ${savedLabel(d.updatedAt)}`}
                  trailing={
                    <View style={styles.trail}>
                      <View style={styles.badges}>
                        <Chip label="Draft" tone="blue" />
                        {submittedDays.has(d.date) ? (
                          <Chip label="Day submitted" tone="orange" />
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => confirmDelete(d)}
                        disabled={busyId === d.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete draft for ${dateLabel(d.date)}`}
                        hitSlop={8}
                        style={styles.trash}
                      >
                        <Icon name="trash-can-outline" color={colors.danger} size={20} />
                      </Pressable>
                    </View>
                  }
                  onPress={() => openForm({ id: d.id, date: d.date })}
                  divider={i < drafts.length - 1}
                />
              ))}
            </Card>
          )}

          <AppText variant="small" style={styles.section}>
            History
          </AppText>
          {historyQ.isPending ? (
            <SkeletonList count={4} />
          ) : !history.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">No submitted reports this month yet.</AppText>
            </Card>
          ) : (
            <Card>
              {history.map((d, i) => (
                <ListRow
                  key={d.id}
                  icon="check-decagram-outline"
                  tone="green"
                  title={dateLabel(d.date)}
                  subtitle={subtitle(d)}
                  trailing={<Chip label="Submitted" tone="green" />}
                  onPress={() => openForm({ id: d.id, date: d.date })}
                  divider={i < history.length - 1}
                />
              ))}
            </Card>
          )}
        </ScrollView>

        <Pressable
          onPress={() => openForm({ new: '1', date: today })}
          accessibilityRole="button"
          accessibilityLabel="New DCR"
          style={({ pressed }) => [
            styles.fab,
            { bottom: bottom + spacing.lg },
            pressed && styles.fabPressed,
          ]}
        >
          <Icon name="plus" color={colors.onNavy} />
          <AppText variant="button" style={styles.fabText}>
            New DCR
          </AppText>
        </Pressable>
      </View>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { marginTop: spacing.sm },
  pad: { padding: spacing.lg, gap: spacing.sm },
  retry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
  trail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  trash: {
    minWidth: touch.min,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: touch.control,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    backgroundColor: colors.navy,
    boxShadow: shadows.floating,
  },
  fabPressed: { backgroundColor: colors.navyPressed },
  fabText: { color: colors.onNavy },
});
