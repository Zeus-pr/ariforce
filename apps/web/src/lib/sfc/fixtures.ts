/**
 * Small hand-written SFC fixtures for mock mode. Places, distances, modes and categories follow the
 * company's SFC format (one sheet per HQ); people are invented demo names.
 */
import type { SfcEmployee, SfcHq, SfcRow } from './adapter';

export const SFC_HQS: SfcHq[] = [
  {
    id: 'sfc-hq-anamoy',
    name: 'Burdwan Anamoy HQ',
    code: 'HQ-BWN-ANM',
    areaId: 'sfc-area-bwn',
    areaName: 'Burdwan Area',
  },
  {
    id: 'sfc-hq-bmch',
    name: 'Burdwan Bmch HQ',
    code: 'HQ-BWN-BMCH',
    areaId: 'sfc-area-bwn',
    areaName: 'Burdwan Area',
  },
  {
    id: 'sfc-hq-asansol',
    name: 'Asansol HQ',
    code: 'HQ-ASN',
    areaId: 'sfc-area-dgp',
    areaName: 'Durgapur Area',
  },
  {
    id: 'sfc-hq-durgapur',
    name: 'Durgapur HQ',
    code: 'HQ-DGP',
    areaId: 'sfc-area-dgp',
    areaName: 'Durgapur Area',
  },
  {
    id: 'sfc-hq-bankura',
    name: 'Bankura HQ',
    code: 'HQ-BNK',
    areaId: 'sfc-area-bnk',
    areaName: 'Bankura Area',
  },
  {
    id: 'sfc-hq-suri',
    name: 'Suri HQ',
    code: 'HQ-SURI',
    areaId: 'sfc-area-bbm',
    areaName: 'Birbhum Area',
  },
];

/** Mock scope: an ABM is the Burdwan ABM; RBM and above, Director and System Admin see every area. */
export const SFC_SCOPE: Record<string, string[] | 'all'> = {
  area_business_manager: ['sfc-area-bwn'],
  regional_business_manager: 'all',
  zonal_business_manager: 'all',
  sales_manager: 'all',
  general_manager: 'all',
  vice_president: 'all',
  director: 'all',
  system_admin: 'all',
};

const bm = (id: string, name: string, code: string, hqId: string): SfcEmployee => ({
  id,
  name,
  employeeCode: code,
  role: 'business_manager',
  hqId,
  canEdit: true,
});
export const SFC_EMPLOYEES: SfcEmployee[] = [
  bm('sfc-u-anm', 'Demo BM Anamoy', 'SFC-BM-01', 'sfc-hq-anamoy'),
  bm('sfc-u-bmch', 'Demo BM Bmch', 'SFC-BM-02', 'sfc-hq-bmch'),
  bm('sfc-u-bmch2', 'Demo BM Bmch New', 'SFC-BM-03', 'sfc-hq-bmch'),
  bm('sfc-u-asn', 'Demo BM Asansol', 'SFC-BM-04', 'sfc-hq-asansol'),
  bm('sfc-u-dgp', 'Demo BM Durgapur', 'SFC-BM-05', 'sfc-hq-durgapur'),
  bm('sfc-u-bnk', 'Demo BM Bankura', 'SFC-BM-06', 'sfc-hq-bankura'),
  bm('sfc-u-suri', 'Demo BM Suri', 'SFC-BM-07', 'sfc-hq-suri'),
];

type R = [
  from: string,
  to: string,
  km: number | null,
  mode: string,
  category: string,
  actualFare?: boolean,
];
const BIKE = 'BIKE';
const BT = 'BUS / TRAIN';
const ROUTES: Record<string, R[]> = {
  'sfc-u-anm': [
    ['BURDWAN', 'BURDWAN', 0, BIKE, 'HQ'],
    ['BURDWAN', 'KALNA', 71, BIKE, 'EX'],
    ['BURDWAN', 'MEMARI', 35, BIKE, 'EX'],
    ['BURDWAN', 'JAMALPUR TO SUREKALNA', 42, BIKE, 'EX'],
    ['BURDWAN', 'DHANIAKHALI', 55, BIKE, 'EX'],
    ['BURDWAN', 'SASPUR', 35, BIKE, 'EX'],
    ['BURDWAN', 'KOLKATA', 102, BT, 'MEETING', true],
  ],
  'sfc-u-bmch': [
    ['BURDWAN', 'BURDWAN', 0, BIKE, 'HQ'],
    ['BURDWAN', 'KATWA', 65, BIKE, 'EX'],
    ['BURDWAN', 'KANDRA', 65, BIKE, 'EX'],
    ['BURDWAN', 'KIRNAHAR', 71, BIKE, 'EX'],
    ['BURDWAN', 'GUSHKARA', 41, BIKE, 'EX'],
    ['KANDRA', 'KATWA', 30, BIKE, 'EX'],
    ['BURDWAN', 'SALAR', 82, BIKE, 'EX'],
    ['BURDWAN', 'MONTESWAR', 45, BIKE, 'EX'],
    ['BURDWAN', 'KOLKATA', 102, BT, 'MEETING', true],
  ],
  'sfc-u-bmch2': [],
  'sfc-u-asn': [
    ['ASANSOL', 'ASANSOL', 0, BIKE, 'HQ'],
    ['ASANSOL', 'RAGHUNATHPUR TO ADRA', 67, BIKE, 'EX'],
    ['ASANSOL', 'BARAKAR TO SANCTORIA', 28, BIKE, 'EX'],
    ['ASANSOL', 'JAMTARA', 49, BIKE, 'EX'],
    ['ASANSOL', 'RANIGANJ', 28, BIKE, 'EX'],
    ['ASANSOL', 'KOLKATA', 211, BT, 'MEETING', true],
    ['ASANSOL', 'BURDWAN', 111, BT, 'MEETING', true],
  ],
  'sfc-u-dgp': [
    ['DURGAPUR', 'DURGAPUR', 0, BIKE, 'HQ'],
    ['DURGAPUR', 'UKHRA TO LAUDHOA', 28, BIKE, 'EX'],
    ['DURGAPUR', 'PANAGARH TO BUDBUD TO GALSI', 50, BIKE, 'EX'],
    ['GALSI', 'ARAMBAGH', 71, BIKE, 'EX'],
    ['DURGAPUR', 'BURDWAN', 111, BT, 'MEETING', true],
  ],
  'sfc-u-bnk': [
    ['BANKURA', 'BANKURA', 0, BIKE, 'HQ'],
    ['BANKURA', 'BISHNUPUR', 45, BIKE, 'EX'],
    ['BANKURA', 'PURULIA', 95, BIKE, 'EX / OS'],
    ['BANKURA', 'DURGAPUR', 50, BIKE, 'MEETING'],
    ['BANKURA', 'KOLKATA', 211, BT, 'MEETING', true],
  ],
  'sfc-u-suri': [
    ['RAMPURHAT', 'RAMPURHAT', 0, BIKE, 'OS'],
    ['RAMPURHAT', 'MURRARAI', 39, BIKE, 'OUT EX HQ'],
    ['SURI', 'SURI', 0, BIKE, 'HQ'],
    ['SURI', 'RAMPURHAT', 65, BIKE, 'EX HQ'],
    ['SURI', 'KOLKATA', 193, BT, 'MEETING', true],
  ],
};

export function seedRows(userId: string): SfcRow[] {
  return (ROUTES[userId] ?? []).map(
    ([fromPlace, toPlace, distanceKm, travelMode, category, af], i) => ({
      id: `${userId}-r${i + 1}`,
      fromPlace,
      toPlace,
      distanceKm,
      actualFare: !!af,
      travelMode,
      category,
      da: null,
    }),
  );
}
