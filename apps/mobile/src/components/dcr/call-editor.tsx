import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { TextField } from '@/components/text-field';
import { formatHHmmLabel } from '@/lib/clock12';
import type { CustomerScope } from '@/lib/dcr/api';
import {
  brandGroups,
  doctorProductLabel,
  lineValue,
  type DcrDetailProduct,
  type ProductOpt,
} from '@/lib/dcr/adapter';
import { capturePresentation, fieldErrorMessage, isOnDuty, visitCheckIn } from '@/lib/field';
import { KIND_LABEL, type CallDraft, type PobDraft } from '@/lib/dcr/model';
import { formatINR } from '@/lib/money';
import { colors, radius, spacing, touch } from '@/theme';
import { CustomerSheet } from './customer-sheet';
import { Field } from './field';
import { MultiSelectSheet } from './multi-select-sheet';
import { Presentation } from './presentation';

/**
 * One doctor / chemist / stockist call (web dcr-sections CallCard). The visit time is stamped when
 * the call is added and shown read-only. Doctor calls: products by name in the order picked, and
 * the presentation. Chemist / stockist calls: the POB at PTS.
 */
export function CallEditor({
  call,
  index,
  readOnly,
  errors,
  products,
  detail,
  scopes,
  names,
  onChange,
  onRemove,
  onPresented,
}: {
  call: CallDraft;
  index: number;
  readOnly: boolean;
  errors: string[];
  products: ProductOpt[];
  /** options.detailProducts (server grouping for the doctor picker), when the API sends it. */
  detail?: readonly DcrDetailProduct[] | null;
  scopes: CustomerScope[];
  names: Map<string, string>;
  onChange: (p: Partial<CallDraft>) => void;
  onRemove: () => void;
  /** The presentation was opened on this (doctor) call. */
  onPresented: () => void;
}) {
  const [pick, setPick] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [onDuty, setOnDuty] = useState<boolean | null>(null);
  const label = KIND_LABEL[call.kind];
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const isProd = (e: string) => /product|presentation|order|POB|check.?in/i.test(e);
  const checkedIn = !!call.checkInId;

  useEffect(() => {
    if (readOnly || !call.outletId || checkedIn) return;
    let live = true;
    void isOnDuty()
      .then((v) => {
        if (live) setOnDuty(v);
      })
      .catch(() => {
        if (live) setOnDuty(null);
      });
    return () => {
      live = false;
    };
  }, [readOnly, call.outletId, checkedIn]);

  const onCheckIn = async () => {
    if (readOnly || checkedIn || !call.outletId || checkingIn) return;
    if (onDuty === false) {
      Alert.alert('Punch in first', 'Punch in on Home before checking in at a call.');
      return;
    }
    setCheckingIn(true);
    try {
      const checkInId = await visitCheckIn(call.kind, call.outletId);
      onChange({ checkInId });
      setOnDuty(true);
    } catch (e) {
      Alert.alert('Check-in failed', fieldErrorMessage(e));
      void isOnDuty()
        .then(setOnDuty)
        .catch(() => {});
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <View style={styles.call}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="body">
            {label} #{index + 1}
          </AppText>
          <AppText variant="small">
            {call.time ? `Visited ${formatHHmmLabel(call.time)}` : 'Time is recorded when saved'}
          </AppText>
        </View>
        {!readOnly ? (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove call ${index + 1}`}
            style={styles.iconBtn}
          >
            <Icon name="trash-can-outline" color={colors.danger} size={20} />
          </Pressable>
        ) : null}
      </View>
      <Field
        label={label}
        value={call.outletName || undefined}
        placeholder={`Choose ${label.toLowerCase()}`}
        onPress={readOnly ? undefined : () => setPick(true)}
        error={errors.find((e) => !isProd(e))}
      />
      {call.outletId ? (
        <Button
          label={checkedIn ? 'Checked in' : onDuty === false ? 'Punch in first' : 'Check in'}
          variant={checkedIn ? 'success' : onDuty === false ? 'secondary' : 'primary'}
          disabled={readOnly || checkedIn}
          loading={checkingIn}
          loadingLabel="Getting location…"
          onPress={() => void onCheckIn()}
          style={styles.presBtn}
        />
      ) : null}
      {call.kind === 'doctor' ? (
        <DoctorProducts
          call={call}
          byId={byId}
          products={products}
          detail={detail}
          readOnly={readOnly}
          error={errors.find(isProd)}
          onChange={onChange}
          onPresented={onPresented}
        />
      ) : (
        <PobEditor
          lines={call.pob}
          byId={byId}
          products={products}
          readOnly={readOnly}
          onChange={(pob) => onChange({ pob })}
        />
      )}
      <TextField
        label="Remarks"
        value={call.remarks}
        onChangeText={(remarks) => onChange({ remarks })}
        editable={!readOnly}
        maxLength={1000}
      />
      <CustomerSheet
        visible={pick}
        kind={call.kind}
        scopes={scopes}
        names={names}
        value={call.outletId || null}
        onPick={(c) =>
          onChange({
            outletId: c.id,
            outletName: c.name,
            hqId: c.hqId,
            checkInId: null,
            presentationOpened: false,
            presentationOpenedAt: null,
            presentationCapture: null,
          })
        }
        onClose={() => setPick(false)}
      />
    </View>
  );
}

const unknownProduct = (id: string): ProductOpt => ({
  id,
  label: 'Product',
  brand: null,
  composition: null,
  packSize: null,
  pts: null,
  imageUrl: null,
});

function DoctorProducts({
  call,
  byId,
  products,
  detail,
  readOnly,
  error,
  onChange,
  onPresented,
}: {
  call: CallDraft;
  byId: Map<string, ProductOpt>;
  products: ProductOpt[];
  detail?: readonly DcrDetailProduct[] | null;
  readOnly: boolean;
  error?: string;
  onChange: (p: Partial<CallDraft>) => void;
  onPresented: () => void;
}) {
  const [sheet, setSheet] = useState(false);
  const [show, setShow] = useState(false);
  const [openingPres, setOpeningPres] = useState(false);
  const picked = call.productIds.map((id) => byId.get(id) ?? unknownProduct(id));
  // One row per brand label. A SKU already on the call (older drafts) marks its group as picked
  // and is kept as-is; a newly picked group records its representative product.
  const groups = useMemo(() => brandGroups(products, detail), [products, detail]);
  const groupOf = useMemo(() => {
    const m = new Map<string, (typeof groups)[number]>();
    for (const g of groups) for (const id of g.ids) m.set(id, g);
    return m;
  }, [groups]);
  const pickedReps = [...new Set(call.productIds.map((id) => groupOf.get(id)?.repId ?? id))];
  /**
   * Presentation covers this call's current product deck. Any add / remove / reorder clears it
   * so the rep must open Presentation again on the updated list.
   */
  const setProducts = (productIds: string[]) => {
    const same =
      productIds.length === call.productIds.length &&
      productIds.every((id, i) => id === call.productIds[i]);
    if (same) return;
    onChange({
      productIds,
      ...(call.presentationOpened
        ? {
            presentationOpened: false,
            presentationOpenedAt: null,
            presentationCapture: null,
          }
        : {}),
    });
  };
  const onStartPresentation = async () => {
    if (!call.checkInId || openingPres) return;
    if (call.presentationOpened) {
      setShow(true);
      return;
    }
    if (readOnly) return;
    setOpeningPres(true);
    try {
      const presentationCapture = await capturePresentation();
      const presentationOpenedAt = new Date().toISOString();
      onChange({
        presentationOpened: true,
        presentationOpenedAt,
        presentationCapture,
      });
      onPresented();
      setShow(true);
    } catch (e) {
      Alert.alert('Presentation', fieldErrorMessage(e));
    } finally {
      setOpeningPres(false);
    }
  };
  const applyPicked = (repIds: string[]) => {
    const out: string[] = [];
    for (const rep of repIds) {
      const g = groups.find((x) => x.repId === rep);
      const existing = g ? call.productIds.find((id) => g.ids.includes(id)) : undefined;
      const id = existing ?? rep;
      if (!out.includes(id)) out.push(id);
    }
    setProducts(out);
  };
  const move = (i: number, d: -1 | 1) => {
    const xs = [...call.productIds];
    const j = i + d;
    if (j < 0 || j >= xs.length) return;
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    setProducts(xs);
  };
  const removeAt = (i: number) => setProducts(call.productIds.filter((_, j) => j !== i));

  return (
    <View style={styles.block}>
      <Field
        label="Products detailed"
        value={picked.length ? `${picked.length} picked` : undefined}
        placeholder="Choose products"
        onPress={readOnly ? undefined : () => setSheet(true)}
        error={error}
      />
      {picked.map((p, i) => (
        <View key={p.id} style={styles.line}>
          <AppText variant="label" style={styles.order}>
            {i + 1}
          </AppText>
          <AppText variant="body" style={styles.flex} numberOfLines={2}>
            {doctorProductLabel(p)}
          </AppText>
          {!readOnly ? (
            <>
              <Pressable
                onPress={() => move(i, -1)}
                disabled={i === 0}
                accessibilityRole="button"
                accessibilityLabel={`Move ${doctorProductLabel(p)} up`}
                style={[styles.iconBtn, i === 0 && styles.dim]}
              >
                <Icon name="chevron-up" color={colors.navy} size={20} />
              </Pressable>
              <Pressable
                onPress={() => move(i, 1)}
                disabled={i === picked.length - 1}
                accessibilityRole="button"
                accessibilityLabel={`Move ${doctorProductLabel(p)} down`}
                style={[styles.iconBtn, i === picked.length - 1 && styles.dim]}
              >
                <Icon name="chevron-down" color={colors.navy} size={20} />
              </Pressable>
              {!call.presentationOpened ? (
                <Pressable
                  onPress={() => removeAt(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${doctorProductLabel(p)}`}
                  style={styles.iconBtn}
                >
                  <Icon name="trash-can-outline" color={colors.danger} size={20} />
                </Pressable>
              ) : null}
            </>
          ) : null}
        </View>
      ))}
      {picked.length ? (
        <View style={styles.presRow}>
          <Button
            label={
              !call.checkInId
                ? 'Check in to present'
                : call.presentationOpened
                  ? 'Presentation opened'
                  : 'Start presentation'
            }
            variant={call.presentationOpened ? 'success' : call.checkInId ? 'primary' : 'secondary'}
            disabled={!call.checkInId || openingPres}
            loading={openingPres}
            loadingLabel="Getting location…"
            onPress={() => void onStartPresentation()}
            style={styles.presBtn}
          />
        </View>
      ) : null}
      <MultiSelectSheet
        visible={sheet}
        title="Products"
        options={groups.map((g) => ({ value: g.repId, label: g.label }))}
        values={pickedReps}
        loading={!products.length}
        onDone={applyPicked}
        onClose={() => setSheet(false)}
      />
      <Presentation visible={show} products={picked} onClose={() => setShow(false)} />
    </View>
  );
}

function PobEditor({
  lines,
  byId,
  products,
  readOnly,
  onChange,
}: {
  lines: PobDraft[];
  byId: Map<string, ProductOpt>;
  products: ProductOpt[];
  readOnly: boolean;
  onChange: (pob: PobDraft[]) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const ptsOf = (id: string) => byId.get(id)?.pts ?? null;
  const total = lines.reduce((s, l) => s + lineValue(ptsOf(l.productId), l.quantity), 0);
  const unpriced = lines.some((l) => ptsOf(l.productId) == null);
  const setQty = (id: string, q: number) =>
    onChange(
      q < 1
        ? lines.filter((l) => l.productId !== id)
        : lines.map((l) => (l.productId === id ? { ...l, quantity: Math.min(q, 10000) } : l)),
    );

  return (
    <View style={styles.block}>
      <Field
        label="Order booked (POB)"
        value={lines.length ? `${lines.length} product${lines.length === 1 ? '' : 's'}` : undefined}
        placeholder="Add products"
        onPress={readOnly ? undefined : () => setSheet(true)}
      />
      {lines.map((l) => {
        const p = byId.get(l.productId) ?? unknownProduct(l.productId);
        const sub = [p.composition, p.packSize].filter(Boolean).join(' · ');
        const last = l.quantity <= 1;
        return (
          <View key={l.productId} style={styles.pob}>
            <View style={styles.flex}>
              <AppText variant="body" numberOfLines={2}>
                {p.label}
              </AppText>
              {sub ? (
                <AppText variant="small" numberOfLines={2}>
                  {sub}
                </AppText>
              ) : null}
              <AppText variant="small" style={p.pts == null && styles.warn}>
                {p.pts == null ? 'Price not set' : `PTS ${formatINR(p.pts)}`}
              </AppText>
            </View>
            <View style={styles.right}>
              <View style={styles.stepper}>
                {!readOnly ? (
                  <Pressable
                    onPress={() => setQty(l.productId, l.quantity - 1)}
                    accessibilityRole="button"
                    accessibilityLabel={last ? `Remove ${p.label}` : `One less ${p.label}`}
                    style={styles.step}
                  >
                    <Icon
                      name={last ? 'trash-can-outline' : 'minus'}
                      size={18}
                      color={last ? colors.danger : colors.navy}
                    />
                  </Pressable>
                ) : null}
                <AppText variant="label" style={styles.qty}>
                  {l.quantity}
                </AppText>
                {!readOnly ? (
                  <Pressable
                    onPress={() => setQty(l.productId, l.quantity + 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`One more ${p.label}`}
                    style={styles.step}
                  >
                    <Icon name="plus" size={18} color={colors.navy} />
                  </Pressable>
                ) : null}
              </View>
              <AppText variant="label">{formatINR(lineValue(p.pts, l.quantity))}</AppText>
            </View>
          </View>
        );
      })}
      {lines.length ? (
        <View style={styles.total}>
          <AppText variant="label">Call total</AppText>
          <AppText variant="count">{formatINR(total)}</AppText>
        </View>
      ) : null}
      {unpriced ? (
        <AppText variant="small">Products marked “Price not set” count as ₹0 in the total.</AppText>
      ) : null}
      <MultiSelectSheet
        visible={sheet}
        title="Products"
        options={products.map((p) => ({
          value: p.id,
          label: p.label,
          hint: [p.composition, p.packSize].filter(Boolean).join(' · ') || undefined,
        }))}
        values={lines.map((l) => l.productId)}
        loading={!products.length}
        onDone={(ids) =>
          onChange(
            ids.map(
              (id) => lines.find((l) => l.productId === id) ?? { productId: id, quantity: 1 },
            ),
          )
        }
        onClose={() => setSheet(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  call: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.3 },
  block: { gap: spacing.sm },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.min,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  order: { width: 24, textAlign: 'center', color: colors.muted },
  presRow: {
    marginTop: spacing.xs,
  },
  presBtn: {
    alignSelf: 'stretch',
  },
  pob: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.ground,
  },
  step: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  qty: { minWidth: 32, textAlign: 'center' },
  warn: { color: colors.warn },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
});
