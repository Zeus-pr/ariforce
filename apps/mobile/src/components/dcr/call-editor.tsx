import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { TextField } from '@/components/text-field';
import { formatHHmmLabel } from '@/lib/clock12';
import type { CustomerScope } from '@/lib/dcr/api';
import { lineValue, type ProductOpt } from '@/lib/dcr/adapter';
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
  scopes: CustomerScope[];
  names: Map<string, string>;
  onChange: (p: Partial<CallDraft>) => void;
  onRemove: () => void;
  /** The presentation was opened on this (doctor) call. */
  onPresented: () => void;
}) {
  const [pick, setPick] = useState(false);
  const label = KIND_LABEL[call.kind];
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const isProd = (e: string) => /product|presentation|order|POB/i.test(e);

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
      {call.kind === 'doctor' ? (
        <DoctorProducts
          call={call}
          byId={byId}
          products={products}
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
        onPick={(c) => onChange({ outletId: c.id, outletName: c.name, hqId: c.hqId })}
        onClose={() => setPick(false)}
      />
    </View>
  );
}

const unknownProduct = (id: string): ProductOpt => ({
  id,
  label: 'Product',
  composition: null,
  packSize: null,
  pts: null,
  imageUrl: null,
});

function DoctorProducts({
  call,
  byId,
  products,
  readOnly,
  error,
  onChange,
  onPresented,
}: {
  call: CallDraft;
  byId: Map<string, ProductOpt>;
  products: ProductOpt[];
  readOnly: boolean;
  error?: string;
  onChange: (p: Partial<CallDraft>) => void;
  onPresented: () => void;
}) {
  const [sheet, setSheet] = useState(false);
  const [show, setShow] = useState(false);
  const picked = call.productIds.map((id) => byId.get(id) ?? unknownProduct(id));
  const move = (i: number, d: -1 | 1) => {
    const xs = [...call.productIds];
    const j = i + d;
    if (j < 0 || j >= xs.length) return;
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    onChange({ productIds: xs });
  };

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
            {p.label}
          </AppText>
          {!readOnly ? (
            <>
              <Pressable
                onPress={() => move(i, -1)}
                disabled={i === 0}
                accessibilityRole="button"
                accessibilityLabel={`Move ${p.label} up`}
                style={[styles.iconBtn, i === 0 && styles.dim]}
              >
                <Icon name="chevron-up" color={colors.navy} size={20} />
              </Pressable>
              <Pressable
                onPress={() => move(i, 1)}
                disabled={i === picked.length - 1}
                accessibilityRole="button"
                accessibilityLabel={`Move ${p.label} down`}
                style={[styles.iconBtn, i === picked.length - 1 && styles.dim]}
              >
                <Icon name="chevron-down" color={colors.navy} size={20} />
              </Pressable>
            </>
          ) : null}
        </View>
      ))}
      {picked.length ? (
        <View style={styles.presRow}>
          <Chip
            label={call.presentationOpened ? 'Presentation opened' : 'Presentation not opened'}
            tone={call.presentationOpened ? 'green' : 'orange'}
          />
          <Button
            label="Start presentation"
            variant="tint"
            compact
            onPress={() => {
              setShow(true);
              if (!readOnly) onPresented();
            }}
          />
        </View>
      ) : null}
      <MultiSelectSheet
        visible={sheet}
        title="Products"
        options={products.map((p) => ({ value: p.id, label: p.label }))}
        values={call.productIds}
        loading={!products.length}
        onDone={(ids) => onChange({ productIds: ids })}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
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
