import type { Dcr } from '@ariforce/contracts';
import { Redirect, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { SelectSheet } from '@/components/masters/select-sheet';
import { mockTpCard, rangeLabel, useMyTps, type TpDraftCard } from '@/lib/tp/adapter';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { useDeleteDraft, useDraftList, useDcrOptions, useSubmittedHistory } from '@/lib/dcr/api';
import { REVIEW_LABEL, REVIEW_TONE, counts, reviewOf, useDecisions } from '@/lib/dcr/adapter';
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
  const decisionsQ = useDecisions();
  const { user } = useAuth();
  const tpsQ = useMyTps(user?.id);
  const approvedTps = useMemo(
    () => (tpsQ.data ?? []).filter((t) => t.status === 'approved' && t.to >= today),
    [tpsQ.data, today],
  );
  const tpFrom = approvedTps.reduce((m, t) => (t.from < m ? t.from : m), today);
  const tpTo = approvedTps.reduce((m, t) => (t.to > m ? t.to : m), today);
  const tpFiledQ = useSubmittedHistory(tpFrom, tpTo);
  const [pickTp, setPickTp] = useState<TpDraftCard | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const workTypeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of normaliseWorkTypes(optionsQ.data?.workTypes ?? [])) map.set(w.id, w.name);
    return map;
  }, [optionsQ.data]);

  const history = useMemo(
    () =>
      (historyQ.data?.items ?? [])
        .filter((d) => d.status !== 'draft' && (d.submittedAt || d.status !== 'locked'))
        .map((d) => ({ d, review: reviewOf(d, decisionsQ.data) })),
    [historyQ.data, decisionsQ.data],
  );
  // Rejected reports never count and never block the day: the rep files it again.
  const submittedDays = useMemo(() => {
    const m = new Map<string, string>();
    for (const { d, review } of history) if (counts(review)) m.set(d.date, d.id);
    return m;
  }, [history]);

  // Approved TPs as one draft card each: options.tourPlanDrafts once the TP API is live, else the
  // same rule on the mock (unfiled days from today on; past days are locked and drop out).
  const tpCards = useMemo(() => {
    const live = (optionsQ.data as { tourPlanDrafts?: TpDraftCard[] } | undefined)?.tourPlanDrafts;
    if (live) return [...live].sort((a, b) => a.from.localeCompare(b.from));
    const filed = new Set(
      (tpFiledQ.data?.items ?? [])
        .filter((d) => d.status !== 'draft' && counts(reviewOf(d, decisionsQ.data)))
        .map((d) => d.date),
    );
    const drafted = new Set(
      (draftsQ.data?.items ?? []).filter((d) => d.status === 'draft').map((d) => d.date),
    );
    return approvedTps
      .map((t) => mockTpCard(t, filed, drafted, today))
      .filter((c): c is TpDraftCard => !!c)
      .sort((a, b) => a.from.localeCompare(b.from));
  }, [optionsQ.data, approvedTps, tpFiledQ.data, draftsQ.data, decisionsQ.data, today]);
  const openTpDay = (t: TpDraftCard, date: string) => openForm({ new: '1', date, tp: t.id });

  const drafts = useMemo(
    () => (draftsQ.data?.items ?? []).filter((d) => d.status === 'draft'),
    [draftsQ.data],
  );

  const refresh = () => Promise.all([draftsQ.refetch(), historyQ.refetch(), optionsQ.refetch()]);

  const openForm = (params: { id?: string; date?: string; new?: string; tp?: string }) =>
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
        <PullToRefresh onRefresh={refresh}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: bottom + touch.control + spacing.lg },
            ]}
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

            {tpCards.length ? (
              <Card>
                {tpCards.map((t, i) => (
                  <ListRow
                    key={t.id}
                    icon="calendar-check-outline"
                    tone="blue"
                    title={`TP · ${rangeLabel(t.from, t.to)}`}
                    subtitle={
                      t.pendingDates.length === 1
                        ? `${dateLabel(t.pendingDates[0]!)} to file`
                        : `${t.pendingDates.length} days to file · pick a day`
                    }
                    trailing={<Chip label="Approved plan" tone="green" />}
                    onPress={() =>
                      t.pendingDates.length === 1 ? openTpDay(t, t.pendingDates[0]!) : setPickTp(t)
                    }
                    divider={i < tpCards.length - 1}
                  />
                ))}
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
              {historyQ.isPending
                ? 'History'
                : `History · ${submittedDays.size} day${submittedDays.size === 1 ? '' : 's'} filed this month`}
            </AppText>
            {historyQ.isPending ? (
              <SkeletonList count={4} />
            ) : !history.length ? (
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">No submitted reports this month yet.</AppText>
              </Card>
            ) : (
              <Card>
                {history.map(({ d, review }, i) => (
                  <ListRow
                    key={d.id}
                    icon={
                      review.status === 'rejected'
                        ? 'close-octagon-outline'
                        : 'check-decagram-outline'
                    }
                    tone={review.status === 'rejected' ? 'red' : 'green'}
                    title={dateLabel(d.date)}
                    subtitle={
                      review.status === 'rejected'
                        ? `Rejected: ${review.reason || 'no reason given'} · File this day again`
                        : subtitle(d)
                    }
                    trailing={
                      <Chip label={REVIEW_LABEL[review.status]} tone={REVIEW_TONE[review.status]} />
                    }
                    onPress={() => openForm({ id: d.id, date: d.date })}
                    divider={i < history.length - 1}
                  />
                ))}
              </Card>
            )}
          </ScrollView>
        </PullToRefresh>

        <SelectSheet
          visible={!!pickTp}
          title={pickTp ? `File a day · ${rangeLabel(pickTp.from, pickTp.to)}` : 'File a day'}
          // fileableDates (today) can be submitted; other pending days take a draft until the day.
          options={(pickTp?.pendingDates ?? []).map((d) => ({
            value: d,
            label: dateLabel(d),
            hint: pickTp?.fileableDates.includes(d)
              ? 'Today · can submit'
              : pickTp?.draftDates.includes(d)
                ? 'Draft saved · submit on the day'
                : 'Draft until the day',
          }))}
          value={null}
          onPick={(d) => {
            const t = pickTp;
            setPickTp(null);
            if (d && t) openTpDay(t, d);
          }}
          onClose={() => setPickTp(null)}
        />

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
