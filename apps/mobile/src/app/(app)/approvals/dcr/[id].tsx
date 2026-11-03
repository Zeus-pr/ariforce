import type { Dcr } from '@ariforce/contracts';
import { useQueries } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { DecisionBar } from '@/components/approvals/decision-bar';
import { DcrSfcReview } from '@/components/approvals/sfc-review';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ScrollView } from '@/components/scroll';
import { SkeletonDetail } from '@/components/skeleton';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  REVIEW_LABEL,
  REVIEW_TONE,
  callPresentationOpened,
  doctorProductLabel,
  decisionErrorMessage,
  useDcrProducts,
  lineValue,
  reviewOf,
  useDecideDcr,
  useDecisions,
  useTeamNames,
} from '@/lib/dcr/adapter';
import { useDcrOptions, useDcrRecord, useDcrTerritories } from '@/lib/dcr/api';
import { dateLabel, savedLabel } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { BAND_LABEL, KIND_LABEL, timeOfIso, territoryRows } from '@/lib/dcr/model';
import { formatHHmmLabel } from '@/lib/clock12';
import { formatINR } from '@/lib/money';
import { isApprover } from '@/lib/roles';
import { layout, spacing } from '@/theme';

const OUTLET_PATH = { doctor: '/v1/doctors', chemist: '/v1/chemists', stockist: '/v1/stockists' };

/** One team DCR, read-only, with approve / reject for the whole report. */
export default function ReviewDcrScreen() {
  const { user } = useAuth();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  if (!isApprover(user?.roles ?? [])) return <Redirect href="/" />;
  return <Review id={id} repName={name || 'Team member'} />;
}

function Review({ id, repName }: { id: string; repName: string }) {
  const router = useRouter();
  const bottom = useBottomSpace();
  const recordQ = useDcrRecord(id);
  const d = recordQ.data;
  const optionsQ = useDcrOptions(d?.date ?? '');
  const productsQ = useDcrProducts(optionsQ.data, !!d);
  const terrQ = useDcrTerritories(!!d);
  const namesQ = useTeamNames(!!d);
  const decisionsQ = useDecisions();
  const decide = useDecideDcr();
  const [error, setError] = useState<string | null>(null);

  const placeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of territoryRows(terrQ.data ?? [])) m.set(r.id, r.name);
    return m;
  }, [terrQ.data]);

  const outlets = useQueries({
    queries: (d?.calls ?? []).map((c) => ({
      queryKey: ['outlet', c.outletKind, c.outletId],
      staleTime: 10 * 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiFetch<{ name: string }>(`${OUTLET_PATH[c.outletKind]}/${c.outletId}`, { signal }),
    })),
  });
  const product = useMemo(
    () => new Map((productsQ.data ?? []).map((p) => [p.id, p])),
    [productsQ.data],
  );

  if (recordQ.isPending)
    return (
      <View style={[styles.flex, styles.content]}>
        <Stack.Screen options={{ title: 'Review DCR' }} />
        <SkeletonDetail fields={6} />
      </View>
    );
  if (!d)
    return (
      <View style={[styles.flex, styles.content]}>
        <Stack.Screen options={{ title: 'Review DCR' }} />
        <AppText variant="bodyMuted">{saveMessage(recordQ.error)}</AppText>
      </View>
    );

  const review = reviewOf(d, decisionsQ.data);
  const workType = optionsQ.data?.workTypes.find((w) => w.id === d.workTypeId)?.name;
  const pobTotal = (c: Dcr['calls'][number]) =>
    c.pob.reduce((s, l) => s + lineValue(product.get(l.productId)?.pts ?? null, l.quantity), 0);
  const dayPob = d.calls.reduce((s, c) => s + pobTotal(c), 0);
  const what = `${repName}'s DCR for ${dateLabel(d.date)}`;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Review DCR' }} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
      >
        <Card style={styles.pad}>
          <View style={styles.row}>
            <AppText variant="section" style={styles.flex}>
              {repName}
            </AppText>
            <Chip label={REVIEW_LABEL[review.status]} tone={REVIEW_TONE[review.status]} />
          </View>
          <AppText variant="body">{dateLabel(d.date)}</AppText>
          <AppText variant="bodyMuted">
            {[workType, d.band ? BAND_LABEL[d.band] : null, `${d.calls.length} calls`]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
          {d.submittedAt ? (
            <AppText variant="small">Submitted {savedLabel(d.submittedAt)}</AppText>
          ) : null}
          {d.deviationReason ? (
            <AppText variant="small">Differs from tour plan: {d.deviationReason}</AppText>
          ) : null}
          {review.status === 'rejected' && review.reason ? (
            <AppText variant="small">Rejected: {review.reason}</AppText>
          ) : null}
          {dayPob > 0 ? <AppText variant="label">Day POB {formatINR(dayPob)}</AppText> : null}
        </Card>

        <Card style={styles.pad}>
          <AppText variant="label">Work on</AppText>
          <AppText variant="body">
            {[workType, d.band ? BAND_LABEL[d.band] : null].filter(Boolean).join(' · ') || '—'}
          </AppText>
          {d.territoryIds.length ? (
            <>
              <AppText variant="label">Territories</AppText>
              <AppText variant="body">
                {d.territoryIds.map((x) => placeName.get(x) ?? 'Territory').join(', ')}
              </AppText>
            </>
          ) : null}
          {d.workWithUserIds?.length ? (
            <>
              <AppText variant="label">Work with</AppText>
              <AppText variant="body">
                {d.workWithUserIds.map((u) => namesQ.data?.get(u) ?? 'Colleague').join(', ')}
              </AppText>
            </>
          ) : d.band ? (
            <>
              <AppText variant="label">Work with</AppText>
              <AppText variant="body">Alone</AppText>
            </>
          ) : null}
        </Card>

        <DcrSfcReview dcr={d} />

        {d.details ? (
          <Card style={styles.pad}>
            <AppText variant="label">
              {d.details.kind[0]!.toUpperCase() + d.details.kind.slice(1)}
            </AppText>
            {'title' in d.details ? <AppText variant="body">{d.details.title}</AppText> : null}
            {'description' in d.details ? (
              <AppText variant="body">{d.details.description}</AppText>
            ) : null}
          </Card>
        ) : null}

        {d.calls.map((c, i) => {
          const opened = callPresentationOpened(c);
          const total = pobTotal(c);
          return (
            <Card key={c.id} style={styles.pad}>
              <View style={styles.row}>
                <AppText variant="label" style={styles.flex}>
                  {KIND_LABEL[c.outletKind]} #{i + 1} · {outlets[i]?.data?.name ?? 'Loading name…'}
                </AppText>
                <AppText variant="small">{formatHHmmLabel(timeOfIso(c.calledAt))}</AppText>
              </View>
              {c.outletKind === 'doctor' ? (
                <>
                  <AppText variant="bodyMuted">
                    {c.productsDetailed.length
                      ? [...c.productsDetailed]
                          .sort((a, b) => a.order - b.order)
                          .map((p) =>
                            product.get(p.productId)
                              ? doctorProductLabel(product.get(p.productId)!)
                              : 'Product',
                          )
                          .join(', ')
                      : 'No products'}
                  </AppText>
                  <AppText variant="small">
                    Presentation:{' '}
                    {opened === undefined ? 'not reported yet' : opened ? 'opened' : 'not opened'}
                  </AppText>
                </>
              ) : c.pob.length ? (
                <>
                  {c.pob.map((l) => {
                    const p = product.get(l.productId);
                    return (
                      <View key={l.productId} style={styles.row}>
                        <AppText variant="body" style={styles.flex}>
                          {p?.label ?? 'Product'} × {l.quantity}
                        </AppText>
                        <AppText variant="body">
                          {p?.pts == null
                            ? 'Price not set'
                            : formatINR(lineValue(p.pts, l.quantity))}
                        </AppText>
                      </View>
                    );
                  })}
                  <View style={styles.row}>
                    <AppText variant="label" style={styles.flex}>
                      Call total
                    </AppText>
                    <AppText variant="label">{formatINR(total)}</AppText>
                  </View>
                </>
              ) : (
                <AppText variant="bodyMuted">No order booked</AppText>
              )}
              {c.remarks ? <AppText variant="small">Remarks: {c.remarks}</AppText> : null}
            </Card>
          );
        })}

        {review.status === 'submitted' ? (
          <Card style={styles.pad}>
            <DecisionBar
              what={what}
              busy={decide.isPending}
              error={error}
              onDecide={(decision, reason) => {
                setError(null);
                decide.mutate(
                  { id: d.id, decision, reason },
                  {
                    onSuccess: () => {
                      Alert.alert(decision === 'approve' ? 'Approved' : 'Rejected', `${what}.`);
                      router.back();
                    },
                    onError: (e) => setError(decisionErrorMessage(e)),
                  },
                );
              }}
            />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  pad: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
