/**
 * Pure helpers for scripts/import-sfc.mts (SFC workbook -> sfc_routes). No DB access here so the
 * parsing and matching rules are unit-tested with a synthetic workbook. See docs/SFC.md.
 */
import ExcelJS from 'exceljs';
import type { SFC_TRAVEL_MODES } from '@ariforce/contracts';

type SfcTravelMode = (typeof SFC_TRAVEL_MODES)[number];

export interface SfcSheetRow {
  sl: number | null;
  fromPlace: string;
  toPlace: string;
  oneWayKm: number;
  actualFare: boolean;
  travelMode: SfcTravelMode | null;
  category: string | null;
}
export interface SfcSheet {
  title: string;
  bmName: string;
  hqText: string;
  rows: SfcSheetRow[];
  skippedEmpty: number;
  problems: string[];
}

const clean = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const cellValue = (v: ExcelJS.CellValue): unknown => {
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result ?? null;
    if ('formula' in v) return null;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
};

/** '71 KM', '67 KM ', '50KM', '0', 0 -> number; null when not a distance. */
export function parseKm(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const s = clean(v)
    .toUpperCase()
    .replace(/KMS?\.?$/, '')
    .trim();
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export function parseMode(v: unknown): SfcTravelMode | null {
  const s = clean(v).toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  if (s === 'BIKE' || s === 'MOTORCYCLE') return 'bike';
  if (s === 'BUS/TRAIN' || s === 'TRAIN/BUS') return 'bus_train';
  if (s === 'BUS') return 'bus';
  if (s === 'TRAIN') return 'train';
  if (s === 'CAR') return 'car';
  return 'other';
}

/** Trims and unifies spacing around '/', e.g. 'EX/ OS' -> 'EX / OS'. */
export function normCategory(v: unknown): string | null {
  const s = clean(v)
    .replace(/\s*\/\s*/g, ' / ')
    .toUpperCase();
  return s ? s.slice(0, 40) : null;
}

const isActual = (v: unknown) => /ACTUAL/i.test(clean(v));

export async function parseSfcWorkbook(file: string): Promise<SfcSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out: SfcSheet[] = [];
  wb.eachSheet((ws) => {
    const sheet: SfcSheet = {
      title: ws.name,
      bmName: '',
      hqText: '',
      rows: [],
      skippedEmpty: 0,
      problems: [],
    };
    let header: Record<
      'sl' | 'from' | 'to' | 'km' | 'amt' | 'amt2' | 'mode' | 'cat',
      number
    > | null = null;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = Array.from(row.values as ExcelJS.CellValue[], cellValue);
      const texts = vals.map((v) => clean(v).toUpperCase());
      if (!header) {
        const bi = texts.findIndex((t) => t.startsWith('BM NAME'));
        if (bi >= 0) {
          const after = texts[bi]!.replace(/^BM NAME\s*:?/, '').trim();
          sheet.bmName = after || clean(vals[bi + 1]);
          const hq = texts.find((t) => /^HQ\s*:/.test(t));
          sheet.hqText = hq ? hq.replace(/^HQ\s*:/, '').trim() : '';
          return;
        }
        if (texts.some((t) => t.startsWith('FROM PLACE'))) {
          const find = (re: RegExp) => texts.findIndex((t) => re.test(t));
          header = {
            sl: find(/^SL/),
            from: find(/^FROM/),
            to: find(/^TO PLACE/),
            km: find(/^DISTANCE ONE/),
            amt: find(/^AMOUNT ONE/),
            amt2: find(/^AMOUNT BOTH/),
            mode: find(/TRAVEL.?MODE/),
            cat: find(/^CATEGORY/),
          };
        }
        return;
      }
      const h = header;
      const from = clean(vals[h.from]);
      const to = clean(vals[h.to]);
      const slRaw = vals[h.sl];
      const sl = typeof slRaw === 'number' ? slRaw : parseKm(slRaw);
      if (!from && !to) {
        sheet.skippedEmpty++;
        return;
      }
      const km = parseKm(vals[h.km]);
      if (!from || !to || km === null) {
        sheet.problems.push(`row ${row.number}: missing place or distance`);
        return;
      }
      sheet.rows.push({
        sl,
        fromPlace: from.toUpperCase(),
        toPlace: to.toUpperCase(),
        oneWayKm: km,
        actualFare: isActual(vals[h.amt]) || isActual(vals[h.amt2]),
        travelMode: h.mode >= 0 ? parseMode(vals[h.mode]) : null,
        category: h.cat >= 0 ? normCategory(vals[h.cat]) : null,
      });
    });
    if (!header) sheet.problems.push('no header row (FROM PLACE ...) found');
    if (!sheet.bmName) sheet.problems.push('no "BM NAME :" row found');
    out.push(sheet);
  });
  return out;
}

const letters = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .split(' ')
    .filter((t) => t && t !== 'HQ');
function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length]!;
}
const ratio = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
/** Token similarity 0..1: each token of `a` against its best token in `b`, averaged. */
export function similarity(a: string, b: string) {
  const ta = letters(a);
  const tb = letters(b);
  if (!ta.length || !tb.length) return 0;
  return ta.reduce((s, x) => s + Math.max(...tb.map((y) => ratio(x, y))), 0) / ta.length;
}

export interface SfcCandidate {
  id: string;
  name: string;
  hqs: { id: string; name: string; code: string }[];
}
export type SfcMatch =
  | { kind: 'matched'; user: SfcCandidate; hqId: string; nameScore: number; hqScore: number }
  | { kind: 'unmatched' | 'ambiguous'; reason: string };

export const NAME_MIN = 0.75;
export const HQ_MIN = 0.7;

/** Fuzzy match a sheet's BM by name AND HQ. Two candidates within 0.05 = ambiguous. */
export function matchSheet(
  sheet: Pick<SfcSheet, 'bmName' | 'hqText'>,
  cands: SfcCandidate[],
): SfcMatch {
  const scored = cands
    .map((c) => {
      const hq = c.hqs
        .map((h) => ({
          h,
          s: Math.max(similarity(sheet.hqText, h.name), similarity(sheet.hqText, h.code)),
        }))
        .sort((a, b) => b.s - a.s)[0];
      return { c, name: similarity(sheet.bmName, c.name), hq };
    })
    .filter((x) => x.name >= NAME_MIN && x.hq && x.hq.s >= HQ_MIN)
    .sort((a, b) => b.name + b.hq!.s - (a.name + a.hq!.s));
  if (!scored.length)
    return {
      kind: 'unmatched',
      reason: `no employee like "${sheet.bmName}" on HQ "${sheet.hqText}"`,
    };
  const [a, b] = scored;
  if (b && a!.name + a!.hq!.s - (b.name + b.hq!.s) < 0.05)
    return {
      kind: 'ambiguous',
      reason: `"${sheet.bmName}" matches ${a!.c.name} and ${b.c.name}`,
    };
  return { kind: 'matched', user: a!.c, hqId: a!.hq!.h.id, nameScore: a!.name, hqScore: a!.hq!.s };
}
