/** Pictures drawn from KPI and DCR payloads the app already loads. No new request shape. */

export type FigureMetric = {
  kpi: string;
  value: number | null;
  numerator?: number | null;
  denominator?: number | null;
  unit: 'count' | 'ratio' | 'percent' | 'inr';
  target?: number | null;
};

export type FigureRow = {
  id: string;
  label: string;
  metrics: FigureMetric[];
};

const metric = (metrics: FigureMetric[], kpi: string) => metrics.find((m) => m.kpi === kpi);

export function ringModel(
  kpis: readonly string[],
  metrics: FigureMetric[],
  format: (unit: FigureMetric['unit'], value: number | null) => string,
): { title: string; percent: number | null; caption: string } | null {
  if (kpis.includes('coverage_pct')) {
    const cov = metric(metrics, 'coverage_pct');
    if (!cov) return null;
    const seen = metric(metrics, 'unique_doctors_seen')?.value;
    const list = metric(metrics, 'msl_size')?.value;
    const caption =
      seen != null && list != null ? `${Math.round(seen)} of ${Math.round(list)} doctors` : '';
    return { title: 'Coverage', percent: cov.value, caption };
  }
  if (kpis.includes('secondary_achievement_pct')) {
    const ach = metric(metrics, 'secondary_achievement_pct');
    if (!ach) return null;
    const sales = metric(metrics, 'secondary_sales_value');
    const caption =
      sales?.value != null && sales.target != null
        ? `${format('inr', sales.value)} of ${format('inr', sales.target)}`
        : '';
    return { title: 'Secondary sales', percent: ach.value, caption };
  }
  if (kpis.includes('dcr_compliance_pct')) {
    const dcr = metric(metrics, 'dcr_compliance_pct');
    if (!dcr) return null;
    const caption =
      dcr.numerator != null && dcr.denominator != null
        ? `${Math.round(dcr.numerator)} of ${Math.round(dcr.denominator)} working days`
        : '';
    return { title: 'DCR compliance', percent: dcr.value, caption };
  }
  return null;
}

/** Primary and secondary, each as its own ring. Used on Sales. */
export function salesRings(
  metrics: FigureMetric[],
  format: (unit: FigureMetric['unit'], value: number | null) => string,
): { title: string; percent: number | null; caption: string }[] {
  return (
    [
      ['primary_achievement_pct', 'primary_sales_value', 'Primary'],
      ['secondary_achievement_pct', 'secondary_sales_value', 'Secondary'],
    ] as const
  ).map(([achKey, valueKey, title]) => {
    const ach = metric(metrics, achKey);
    const sales = metric(metrics, valueKey);
    const caption =
      sales?.value != null && sales.target != null
        ? `${format('inr', sales.value)} of ${format('inr', sales.target)}`
        : sales?.value != null
          ? format('inr', sales.value)
          : '';
    return { title, percent: ach?.value ?? null, caption };
  });
}

export type RankBar = {
  id: string;
  label: string;
  text: string;
  note?: string;
  share: number;
  lead: boolean;
};

/** Percent bars are out of 100. Money and counts are out of the largest value. */
export function rankBars(
  rows: FigureRow[],
  kpi: string,
  format: (unit: FigureMetric['unit'], value: number | null) => string,
  noteKpi?: string,
): RankBar[] {
  const scored = rows.map((row) => {
    const m = metric(row.metrics, kpi);
    return { row, m, value: m?.value ?? null };
  });
  const values = scored.map((s) => s.value).filter((v): v is number => v != null);
  const top = values.length ? Math.max(...values) : 0;
  const unit = scored.find((s) => s.m)?.m?.unit ?? 'count';
  const percent = unit === 'percent';
  return scored
    .slice()
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
    .map((s) => {
      const note = noteKpi ? metric(s.row.metrics, noteKpi) : undefined;
      return {
        id: s.row.id,
        label: s.row.label,
        text: s.m ? format(s.m.unit, s.m.value) : '—',
        note: note ? `Primary ${format(note.unit, note.value)}` : undefined,
        share:
          s.value == null
            ? 0
            : percent
              ? Math.min(1, Math.max(0, s.value / 100))
              : top <= 0
                ? 0
                : s.value / top,
        lead: s.value != null && s.value === top,
      };
    });
}

export type GapBar = {
  id: string;
  name: string;
  label: string;
  text: string;
  share: number;
};

const WORSE_HIGH = new Set(['missed_doctor_pct']);

/** Up to three people or zones furthest from a good month. */
export function gapBars(
  rows: FigureRow[],
  kpis: readonly string[],
  format: (unit: FigureMetric['unit'], value: number | null) => string,
): GapBar[] {
  const wanted = kpis.filter((k) =>
    [
      'coverage_pct',
      'missed_doctor_pct',
      'secondary_achievement_pct',
      'primary_achievement_pct',
      'dcr_compliance_pct',
      'tp_adherence_pct',
    ].includes(k),
  );
  const out: GapBar[] = [];
  for (const kpi of wanted) {
    let worst: { row: FigureRow; m: FigureMetric } | null = null;
    for (const row of rows) {
      const m = metric(row.metrics, kpi);
      if (m?.value == null) continue;
      if (!worst || worse(kpi, m.value, worst.m.value!)) worst = { row, m };
    }
    if (!worst || worst.m.value == null) continue;
    const high = WORSE_HIGH.has(kpi);
    out.push({
      id: `${worst.row.id}:${kpi}`,
      name: worst.row.label,
      label: kpi,
      text: format(worst.m.unit, worst.m.value),
      share: high
        ? Math.min(1, worst.m.value / 100)
        : 1 - Math.min(1, Math.max(0, worst.m.value / 100)),
    });
    if (out.length === 3) break;
  }
  return out;
}

function worse(kpi: string, value: number, best: number) {
  return WORSE_HIGH.has(kpi) ? value > best : value < best;
}

export type CallSlice = { kind: 'doctor' | 'chemist' | 'stockist'; count: number };

const FILED = new Set(['submitted', 'locked', 'approved']);

export function callMix(
  dcrs: {
    status: string;
    calls?: { outletKind: string; samples?: unknown[]; pob?: unknown[] }[];
  }[],
): { slices: CallSlice[]; samples: number; orders: number; quiet: number } {
  const count = { doctor: 0, chemist: 0, stockist: 0 };
  let samples = 0;
  let orders = 0;
  let quiet = 0;
  for (const d of dcrs) {
    if (!FILED.has(d.status)) continue;
    for (const call of d.calls ?? []) {
      if (
        call.outletKind === 'doctor' ||
        call.outletKind === 'chemist' ||
        call.outletKind === 'stockist'
      )
        count[call.outletKind] += 1;
      const sampleQty = (call.samples ?? []).length;
      const pobQty = (call.pob ?? []).length;
      samples += sampleQty;
      orders += pobQty;
      if (!sampleQty && !pobQty) quiet += 1;
    }
  }
  return {
    slices: [
      { kind: 'doctor', count: count.doctor },
      { kind: 'chemist', count: count.chemist },
      { kind: 'stockist', count: count.stockist },
    ],
    samples,
    orders,
    quiet,
  };
}

export type DayMark = 'filed' | 'open' | 'rest' | 'ahead';

/** One mark per calendar day. Sunday is a rest day. Days after `today` are ahead. */
export function monthMarks(
  month: string,
  today: string,
  filed: ReadonlySet<string>,
): { day: string; mark: DayMark }[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const out: { day: string; mark: DayMark }[] = [];
  for (let d = 1; d <= last; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`;
    const sunday = new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
    const mark: DayMark =
      day > today ? 'ahead' : sunday ? 'rest' : filed.has(day) ? 'filed' : 'open';
    out.push({ day, mark });
  }
  return out;
}

export function filedDates(dcrs: { status: string; date: string }[]): Set<string> {
  return new Set(dcrs.filter((d) => FILED.has(d.status)).map((d) => d.date));
}
