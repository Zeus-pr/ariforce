/**
 * POB desk — today's chemist/stockist orders booked on the DCR.
 * Editing still happens in the DCR call editor (one write path).
 */
import { useQueries } from '@tanstack/react-query';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDcrProducts } from '@/lib/dcr/adapter';
import { useDcrOptions } from '@/lib/dcr/api';
import { dateLabel, todayIST } from '@/lib/dcr/dates';
import { formatINR } from '@/lib/money';
import {
  pobCallsFromDcr,
  pobDayTotal,
  pobKindLabel,
  pobMessage,
  todayDcr,
  type PobCallRow,
} from '@/lib/pob';
import { isSalesRole } from '@/lib/roles';
import { colors, fonts, layout, radius, spacing, touch } from '@/theme';

const OUTLET_PATH = {
  chemist: '/v1/chemists',
  stockist: '/v1/stockists',
} as const;

/** Sales ladder only — same gate as DCR (POB lives on chemist/stockist calls). */
export default function PobScreen() {
  const { user } = useAuth();
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  return <PobDesk />;
}

function PobDesk() {
  const router = useRouter();
  const bottom = useBottomSpace();
  const today = todayIST();
  const optionsQ = useDcrOptions(today);
  const productsQ = useDcrProducts(optionsQ.data, true);
  const dcr = todayDcr(optionsQ.data);
  const product = useMemo(
    () => new Map((productsQ.data ?? []).map((p) => [p.id, p])),
    [productsQ.data],
  );
  const rows = useMemo(() => pobCallsFromDcr(dcr, product), [dcr, product]);
  const dayTotal = pobDayTotal(rows);
  const lineCount = rows.reduce((s, r) => s + r.productCount, 0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const outlets = useQueries({
    queries: rows.map((r) => ({
      queryKey: ['outlet', r.outletKind, r.outletId],
      staleTime: 10 * 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiFetch<{ name: string }>(`${OUTLET_PATH[r.outletKind]}/${r.outletId}`, { signal }),
    })),
  });

  const pending = optionsQ.isPending || (rows.length > 0 && productsQ.isPending);
  const error = optionsQ.error;

  function openDcr() {
    if (dcr?.id) {
      router.push({ pathname: '/dcr/form', params: { id: dcr.id } });
      return;
    }
    router.push({ pathname: '/dcr/form', params: { new: '1', date: today } });
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'POB' }} />
      <PullToRefresh onRefresh={() => optionsQ.refetch()}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        >
          <Card style={styles.hero}>
            <AppText variant="small" style={styles.heroEyebrow}>
              {dateLabel(today)} · Today
            </AppText>
            <AppText variant="small">Orders booked</AppText>
            <AppText variant="name" style={styles.heroValue} accessibilityRole="header">
              {pending ? '…' : formatINR(dayTotal)}
            </AppText>
            <AppText variant="bodyMuted">
              {pending
                ? '…'
                : `${rows.length} outlet${rows.length === 1 ? '' : 's'} · ${lineCount} product${lineCount === 1 ? '' : 's'}`}
            </AppText>
            <AppText variant="small" style={styles.heroHint}>
              Add products on a chemist or stockist call in your DCR. Value uses PTS.
            </AppText>
            <Button label="Book an order" onPress={openDcr} />
          </Card>

          <AppText variant="small">{"Today's orders"}</AppText>

          {pending ? (
            <SkeletonList count={3} />
          ) : error ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{pobMessage(error)}</AppText>
            </Card>
          ) : !rows.length ? (
            <Card style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Icon name="cart-outline" size={32} color={colors.tealDeep} />
              </View>
              <AppText variant="section" style={styles.emptyTitle}>
                No orders yet today
              </AppText>
              <AppText variant="bodyMuted" style={styles.emptyBody}>
                {
                  "Open today's DCR, add a chemist or stockist call, then book products. They show up here with the day total."
                }
              </AppText>
              <Button label={"Open today's DCR"} onPress={openDcr} variant="secondary" />
            </Card>
          ) : (
            <Card>
              {rows.map((row, i) => (
                <PobRow
                  key={row.callId}
                  row={row}
                  outletName={outlets[i]?.data?.name}
                  product={product}
                  open={expanded === row.callId}
                  onToggle={() => setExpanded((id) => (id === row.callId ? null : row.callId))}
                  onEdit={openDcr}
                  divider={i < rows.length - 1}
                />
              ))}
            </Card>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

function PobRow({
  row,
  outletName,
  product,
  open,
  onToggle,
  onEdit,
  divider,
}: {
  row: PobCallRow;
  outletName?: string;
  product: ReadonlyMap<string, import('@/lib/dcr/adapter').ProductOpt>;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  divider: boolean;
}) {
  const title = outletName ?? 'Loading name…';
  const subtitle = `${pobKindLabel(row.outletKind)} · ${row.productCount} product${
    row.productCount === 1 ? '' : 's'
  }`;

  return (
    <View style={divider ? styles.rowDivider : undefined}>
      <PressableScale
        onPress={onToggle}
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${subtitle}, ${formatINR(row.total)}`}
        style={styles.rowHead}
        pressedStyle={styles.rowPressed}
      >
        <View style={styles.rowText}>
          <AppText variant="rowTitle" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="small" numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
        <AppText variant="label">{formatINR(row.total)}</AppText>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} color={colors.subtle} />
      </PressableScale>
      {open ? (
        <View style={styles.detail}>
          {row.lines.map((l) => {
            const p = product.get(l.productId);
            return (
              <View key={l.productId} style={styles.line}>
                <View style={styles.flex}>
                  <AppText variant="body" numberOfLines={2}>
                    {p?.label ?? 'Product'}
                  </AppText>
                  <AppText variant="small">× {l.quantity}</AppText>
                </View>
                <AppText variant="body">
                  {p?.pts == null ? 'Price not set' : formatINR(l.value)}
                </AppText>
              </View>
            );
          })}
          <PressableScale
            onPress={onEdit}
            accessibilityLabel={`Edit order for ${title} in DCR`}
            scaleTo={0.97}
            style={styles.editBtn}
            pressedStyle={styles.editBtnPressed}
          >
            <Icon name="pencil-outline" size={18} color={colors.tealDeep} />
            <AppText variant="label" style={styles.editLabel}>
              Edit in DCR
            </AppText>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  pad: { padding: spacing.lg },
  hero: { padding: spacing.lg, gap: spacing.sm },
  heroEyebrow: { color: colors.muted, fontFamily: fonts.semibold },
  heroValue: { color: colors.navy, fontFamily: fonts.bold },
  heroHint: { color: colors.muted },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.tealWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { textAlign: 'center' },
  emptyBody: { textAlign: 'center', maxWidth: 320 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  rowPressed: { backgroundColor: colors.ground },
  rowText: { flex: 1, gap: 2 },
  detail: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xs,
    backgroundColor: colors.ground,
    gap: spacing.sm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tealWash,
    minHeight: touch.min,
  },
  editBtnPressed: { backgroundColor: colors.tealSoft },
  editLabel: { color: colors.tealDeep },
});
