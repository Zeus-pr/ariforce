/**
 * Mock mode only: fixtures for the DCR redesign (Date -> Work On -> Band -> Territory -> Work With ->
 * SFC -> calls). Durgapur HQ territories and its doctor/chemist rows come from the HQ master import
 * (durgapur-territories.csv, see docs/TERRITORY-MODEL.md); Bankura's territories follow its SFC places.
 * SFC routes are the SFC screen's own mock rows (lib/sfc/fixtures), so DCR never carries its own rates.
 * Stockists and Work With people are invented demo records.
 */
import { DGP_CHEMIST_ROWS, DGP_DOCTOR_ROWS } from './csv-rows';

const uid = (block: number, n: number) =>
  `0193dc00-0000-7000-8000-${String(block).padStart(4, '0')}${String(n).padStart(8, '0')}`;

export type MockWorkType = {
  id: string;
  code: string;
  name: string;
  kind: 'field' | 'non_field' | 'leave' | 'holiday';
  band: 'hq' | 'ex_hq' | 'outstation' | null;
};
export const DCR_WORK_TYPES: MockWorkType[] = [
  { id: uid(1, 1), code: 'FIELD-HQ', name: 'Field work (HQ)', kind: 'field', band: 'hq' },
  { id: uid(1, 2), code: 'FIELD-EX', name: 'Field work (Ex-HQ)', kind: 'field', band: 'ex_hq' },
  { id: uid(1, 3), code: 'FIELD-OS', name: 'Field work (Out-station)', kind: 'field', band: 'outstation' },
  { id: uid(1, 4), code: 'MEET', name: 'Meeting', kind: 'non_field', band: null },
  { id: uid(1, 5), code: 'TRAIN', name: 'Training', kind: 'non_field', band: null },
  { id: uid(1, 6), code: 'ADMIN', name: 'Admin work', kind: 'non_field', band: null },
  { id: uid(1, 7), code: 'LEAVE', name: 'Leave', kind: 'leave', band: null },
];

export type MockTerritory = { id: string; code: string; name: string; level: 'headquarter' | 'territory'; parentId: string | null };
const DGP = uid(2, 1);
const BNK = uid(2, 2);
export const DCR_TERRITORIES: MockTerritory[] = [
  { id: DGP, code: 'HQ-DGP', name: 'Durgapur HQ', level: 'headquarter', parentId: null },
  { id: uid(2, 11), code: 'DGP-DURGAPUR', name: 'Durgapur', level: 'territory', parentId: DGP },
  { id: uid(2, 12), code: 'DGP-ARAMBAGH', name: 'Arambagh', level: 'territory', parentId: DGP },
  { id: uid(2, 13), code: 'DGP-INDUS', name: 'Indus', level: 'territory', parentId: DGP },
  { id: BNK, code: 'HQ-BNK', name: 'Bankura HQ', level: 'headquarter', parentId: null },
  { id: uid(2, 21), code: 'BNK-BANKURA', name: 'Bankura', level: 'territory', parentId: BNK },
  { id: uid(2, 22), code: 'BNK-BISHNUPUR', name: 'Bishnupur', level: 'territory', parentId: BNK },
];
/** Which SFC sheet (lib/sfc/fixtures user) holds the signed-in rep's routes for each HQ. */
export const SFC_SHEET_FOR_HQ: Record<string, string> = { [DGP]: 'sfc-u-dgp', [BNK]: 'sfc-u-bnk' };

const terrByText = (hq: string, text: string) =>
  DCR_TERRITORIES.find((t) => t.parentId === hq && t.name.toUpperCase() === text)?.id ?? hq;

/** territoryId is the local territory the importer linked (localTerritoryId), or the HQ id when not linked yet. */
export type MockOutlet = { id: string; kind: 'doctor' | 'chemist' | 'stockist'; name: string; hqId: string; territoryId: string };
export const DCR_OUTLETS: MockOutlet[] = [
  ...DGP_DOCTOR_ROWS.map(([name, t], i): MockOutlet => ({ id: uid(3, i + 1), kind: 'doctor', name, hqId: DGP, territoryId: terrByText(DGP, t) })),
  ...DGP_CHEMIST_ROWS.map(([name, t], i): MockOutlet => ({ id: uid(4, i + 1), kind: 'chemist', name, hqId: DGP, territoryId: terrByText(DGP, t) })),
  { id: uid(5, 1), kind: 'stockist', name: 'Durgapur Medical Agencies', hqId: DGP, territoryId: terrByText(DGP, 'DURGAPUR') },
  { id: uid(5, 2), kind: 'stockist', name: 'City Centre Pharma Distributors', hqId: DGP, territoryId: terrByText(DGP, 'DURGAPUR') },
  // Not linked to a territory yet (localTerritoryId null): only listed under "All of <HQ>".
  { id: uid(3, 801), kind: 'doctor', name: 'Dr. Unlinked Demo Surgeon', hqId: DGP, territoryId: DGP },
  { id: uid(4, 801), kind: 'chemist', name: 'Unlinked Demo Pharmacy', hqId: DGP, territoryId: DGP },
  { id: uid(3, 901), kind: 'doctor', name: 'Dr. Bankura Demo Physician', hqId: BNK, territoryId: terrByText(BNK, 'BANKURA') },
  { id: uid(4, 901), kind: 'chemist', name: 'Bishnupur Demo Medical Hall', hqId: BNK, territoryId: terrByText(BNK, 'BISHNUPUR') },
  { id: uid(5, 901), kind: 'stockist', name: 'Bankura Demo Distributors', hqId: BNK, territoryId: terrByText(BNK, 'BANKURA') },
];

export const DCR_WORK_WITH = [
  { id: uid(6, 1), name: 'Demo ABM Durgapur', employeeCode: 'ABM-DGP-01', designation: 'Area Business Manager' },
  { id: uid(6, 2), name: 'Demo RBM West Bengal', employeeCode: 'RBM-WB-01', designation: 'Regional Business Manager' },
  { id: uid(6, 3), name: 'Demo BM Asansol', employeeCode: 'BM-ASN-01', designation: 'Business Manager' },
  { id: uid(6, 4), name: 'Demo BM Bankura', employeeCode: 'BM-BNK-01', designation: 'Business Manager' },
  { id: uid(6, 5), name: 'Demo Trainer Kolkata', employeeCode: 'TRN-KOL-01', designation: 'Sales Trainer' },
];

/** Stable UUIDs for SFC fixture route ids (the SFC screen uses readable ids). */
/**
 * Extra SFC rows for the DCR mock only, as legacy data looks after migration 0043: mixed-case exact
 * categories ("Ex", " os ") that must match, and combined/unknown ones ("Ex / Os", "Meeting") that the
 * UI must ignore. [from, to, km, travel mode, raw category, actual fare]. Ids follow the sheet rows (100+).
 */
export const DCR_LEGACY_SFC: Record<string, [string, string, number, string, string, boolean?][]> = {
  'sfc-u-dgp': [
    ['DURGAPUR', 'ASANSOL', 42, 'BIKE', 'Ex'],
    ['DURGAPUR', 'KOLKATA', 170, 'BUS / TRAIN', ' os ', true],
    ['DURGAPUR', 'BANKURA', 50, 'BIKE', 'Ex / Os'],
    ['DURGAPUR', 'ASANSOL', 42, 'BIKE', 'Meeting'],
  ],
  'sfc-u-bnk': [['BANKURA', 'SONAMUKHI', 38, 'BIKE', 'eX']],
};
export const LEGACY_ROW_OFFSET = 100;

export const sfcRouteUuid = (sheet: string, index: number) =>
  uid(7, (Object.values(SFC_SHEET_FOR_HQ).indexOf(sheet) + 1) * 1000 + index);
