import type { Dcr } from '@ariforce/contracts';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { dcrStyles } from '@/components/dcr/field';
import { TextField } from '@/components/text-field';
import { REVIEW_LABEL, REVIEW_TONE, reviewOf } from '@/lib/dcr/adapter';
import { dateLabel } from '@/lib/dcr/dates';
import { BANDS } from '@/lib/dcr/model';
import {
  MANUAL_FIELDS,
  dayExpenseSplit,
  taDaFromSfc,
  type Line,
  type LineInput,
  type ManualFieldKey,
  stripManualTag,
  withManualTag,
} from '@/lib/expenses';
import { formatINR } from '@/lib/money';
import { colors, fonts, spacing } from '@/theme';

function moneyInput(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * One day on the expense claim — statement-style:
 * auto TA/DA + SFC/DCR facts (read-only), then manual boxes
 * (Additional TA/DA, Courier, Mobile, Team meeting, Remarks).
 */
const KIND_FALLBACK = { doctor: 'Doctor', chemist: 'Chemist', stockist: 'Stockist' } as const;

function namesOf(
  dcr: Dcr | null | undefined,
  kind: 'doctor' | 'chemist' | 'stockist',
  outletNames?: Map<string, string>,
) {
  const list: string[] = [];
  const seen = new Set<string>();
  for (const c of dcr?.calls ?? []) {
    if (c.outletKind !== kind || seen.has(c.outletId)) continue;
    seen.add(c.outletId);
    list.push(outletNames?.get(c.outletId) ?? KIND_FALLBACK[kind]);
  }
  return list;
}

export function DayClaimCard({
  date,
  lines,
  dcr,
  workTypeName,
  territoryNames,
  outletNames,
  personNames,
  editable,
  busy,
  error,
  onSaveManual,
}: {
  date: string;
  lines: Line[];
  dcr?: Dcr | null;
  workTypeName?: string;
  territoryNames?: string[];
  /** Resolved doctor / chemist / stockist id → name. */
  outletNames?: Map<string, string>;
  /** Team user id → name for accompany. */
  personNames?: Map<string, string>;
  editable: boolean;
  busy?: boolean;
  error?: string | null;
  onSaveManual: (ops: {
    upserts: { line?: Line; body: LineInput }[];
    removes: string[];
  }) => void;
}) {
  const split = useMemo(() => dayExpenseSplit(lines), [lines]);
  const sfc = useMemo(() => (dcr ? taDaFromSfc(dcr) : null), [dcr]);
  const review = dcr ? reviewOf(dcr) : null;
  const band = dcr ? BANDS.find((b) => b.band === dcr.band) : null;
  const doctors = useMemo(() => namesOf(dcr, 'doctor', outletNames), [dcr, outletNames]);
  const chemists = useMemo(() => namesOf(dcr, 'chemist', outletNames), [dcr, outletNames]);
  const stockists = useMemo(() => namesOf(dcr, 'stockist', outletNames), [dcr, outletNames]);
  const accompany = useMemo(() => {
    const ids = dcr?.workWithUserIds ?? [];
    if (!ids.length) return [] as string[];
    return ids.map((id) => personNames?.get(id) ?? 'Colleague');
  }, [dcr, personNames]);
  const workplace = territoryNames?.filter(Boolean).join(' · ') || '—';
  const ta = split.ta || sfc?.ta || 0;
  const da = split.da || sfc?.da || 0;
  const km = split.km || sfc?.km || 0;
  const extras = MANUAL_FIELDS.reduce((s, f) => {
    const line = split.manual[f.key];
    return s + (line?.amount ?? 0);
  }, 0);

  const [amounts, setAmounts] = useState<Record<ManualFieldKey, string>>(() => {
    const init = {} as Record<ManualFieldKey, string>;
    for (const f of MANUAL_FIELDS) {
      const line = split.manual[f.key];
      init[f.key] = line ? String(line.amount) : '';
    }
    return init;
  });
  const [remarks, setRemarks] = useState(() =>
    stripManualTag(split.manual.remarks?.notes ?? null),
  );
  const [localErr, setLocalErr] = useState<string | null>(null);

  const dayTotal =
    ta +
    da +
    (editable
      ? MANUAL_FIELDS.reduce((s, f) => s + (moneyInput(amounts[f.key]) ?? 0), 0)
      : extras);

  const save = () => {
    if (!editable) return;
    const upserts: { line?: Line; body: LineInput }[] = [];
    const removes: string[] = [];
    const dcrId = dcr?.id ?? lines.find((l) => l.dcrId)?.dcrId ?? null;

    for (const f of MANUAL_FIELDS) {
      const amt = moneyInput(amounts[f.key]);
      const existing = split.manual[f.key];
      if (amt == null) {
        if (existing) removes.push(existing.id);
        continue;
      }
      upserts.push({
        line: existing,
        body: {
          date,
          category: 'other',
          amount: amt,
          notes: withManualTag(f.key, ''),
          mileageKm: null,
          dcrId,
          tourPlanId: existing?.tourPlanId ?? null,
        },
      });
    }

    const rem = remarks.trim();
    const remLine = split.manual.remarks;
    if (!rem) {
      if (remLine) removes.push(remLine.id);
    } else if (upserts.length) {
      // Keep remarks on the first manual amount line (no zero-rupee stub).
      const first = upserts[0]!;
      first.body.notes = `${first.body.notes ?? ''}\n${rem}`.trim();
      if (remLine) removes.push(remLine.id);
    } else {
      // Remarks only: tiny placeholder amount (API requires amount > 0).
      upserts.push({
        line: remLine,
        body: {
          date,
          category: 'other',
          amount: 0.01,
          notes: withManualTag('remarks', rem),
          mileageKm: null,
          dcrId,
          tourPlanId: remLine?.tourPlanId ?? null,
        },
      });
    }

    setLocalErr(null);
    onSaveManual({ upserts, removes });
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <AppText variant="label">{dateLabel(date)}</AppText>
          <AppText variant="small" style={styles.muted}>
            {[workTypeName ?? 'Day', band?.label].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        {review ? (
          <Chip label={REVIEW_LABEL[review.status]} tone={REVIEW_TONE[review.status]} />
        ) : (
          <Chip label="No DCR" tone="neutral" />
        )}
      </View>

      <View style={styles.facts}>
        <Fact label="Workplace" value={workplace} />
        <Fact label="Doctors" value={doctors.length ? doctors.join(', ') : '—'} />
        <Fact label="Chemists" value={chemists.length ? chemists.join(', ') : '—'} />
        <Fact label="Stockists" value={stockists.length ? stockists.join(', ') : '—'} />
        <Fact
          label="Accompany"
          value={accompany.length ? accompany.join(', ') : dcr?.band ? 'Alone' : '—'}
        />
        {sfc?.routes.length ? (
          <Fact label="SFC route" value={sfc.routes.join(' · ')} />
        ) : null}
        <Fact label="Distance" value={km ? `${km} km (SFC)` : '—'} />
        <View style={styles.autoRow}>
          <Fact label="Travel allowance" value={formatINR(ta)} strong />
          <Fact label="Daily allowance" value={formatINR(da)} strong />
        </View>
        {!editable && extras > 0 ? (
          <Fact label="Extra expenses" value={formatINR(extras)} strong />
        ) : null}
        <AppText variant="chip" style={styles.autoHint}>
          TA/DA from the DCR’s SFC. Extra expenses below add to the day total.
        </AppText>
      </View>

      {editable ? (
        <View style={styles.manual}>
          <AppText variant="chip" style={styles.sectionLabel}>
            MANUAL (THIS DAY)
          </AppText>
          {MANUAL_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={`${f.label} (₹)`}
              value={amounts[f.key]}
              onChangeText={(t) => setAmounts((a) => ({ ...a, [f.key]: t }))}
              keyboardType="decimal-pad"
            />
          ))}
          <TextField
            label="Remarks"
            value={remarks}
            onChangeText={setRemarks}
            maxLength={500}
            multiline
          />
          <View style={styles.totalRow}>
            <AppText variant="small">Day total</AppText>
            <AppText variant="label">{formatINR(dayTotal)}</AppText>
          </View>
          {localErr || error ? (
            <AppText variant="caption" style={dcrStyles.err}>
              {localErr || error}
            </AppText>
          ) : null}
          <Button
            label="Save day"
            compact
            loading={busy}
            loadingLabel="Saving…"
            onPress={save}
          />
        </View>
      ) : (
        <View style={styles.manual}>
          {MANUAL_FIELDS.map((f) => {
            const line = split.manual[f.key];
            if (!line) return null;
            return (
              <Fact key={f.key} label={f.label} value={formatINR(line.amount)} />
            );
          })}
          {split.manual.remarks ? (
            <Fact label="Remarks" value={stripManualTag(split.manual.remarks.notes)} />
          ) : null}
          <View style={styles.totalRow}>
            <AppText variant="small">Day total</AppText>
            <AppText variant="label">
              {formatINR(dayTotal || lines.reduce((s, l) => s + l.amount, 0))}
            </AppText>
          </View>
        </View>
      )}
    </Card>
  );
}

function Fact({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.fact}>
      <AppText variant="chip" style={styles.factLabel}>
        {label}
      </AppText>
      <AppText variant={strong ? 'label' : 'small'} style={strong ? undefined : styles.muted}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  headLeft: { flex: 1, gap: 2 },
  muted: { color: colors.muted },
  facts: { gap: spacing.sm },
  fact: { gap: 2 },
  factLabel: { color: colors.subtle, fontFamily: fonts.semibold, letterSpacing: 0.3 },
  autoRow: { flexDirection: 'row', gap: spacing.lg },
  autoHint: { color: colors.subtle },
  manual: { gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, paddingTop: spacing.md },
  sectionLabel: { color: colors.subtle, fontFamily: fonts.bold, letterSpacing: 0.5 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
