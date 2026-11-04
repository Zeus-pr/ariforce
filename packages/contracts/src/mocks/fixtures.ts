import type {
  Chemist,
  Doctor,
  DoctorCategory,
  Me,
  Role,
  Specialty,
  Stockist,
  Territory,
  Division,
  Product,
  ProductHqMapping,
  WorkType,
  GeofenceSettings,
  ConsentState,
  Approval,
} from '../index';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS, ROLE_NAMES, ROLE_RANK } from '../schemas/roles';

export const COMPANY_ID = '01930000-0000-7000-8000-000000000001';
const now = '2026-10-26T00:00:00.000Z';
const base = { companyId: COMPANY_ID, createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
const tid = (n: number) => `01930000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

export const territories: Territory[] = [
  {
    ...base,
    id: tid(1),
    parentId: null,
    level: 'national',
    code: 'IN',
    name: 'India',
    path: tid(1),
    centroid: null,
  },
  {
    ...base,
    id: tid(2),
    parentId: tid(1),
    level: 'zone',
    code: 'EZ',
    name: 'East Zone',
    path: `${tid(1)}.${tid(2)}`,
    centroid: null,
  },
  {
    ...base,
    id: tid(3),
    parentId: tid(2),
    level: 'region',
    code: 'WB',
    name: 'West Bengal',
    path: `${tid(1)}.${tid(2)}.${tid(3)}`,
    centroid: null,
  },
  {
    ...base,
    id: tid(4),
    parentId: tid(3),
    level: 'area',
    code: 'KOL-N',
    name: 'Kolkata North',
    path: `${tid(1)}.${tid(2)}.${tid(3)}.${tid(4)}`,
    centroid: { lat: 22.6, lng: 88.4 },
  },
];

/** Headquarter-level territories (served for GET /v1/territories?level=headquarter); Howrah has nobody yet. */
export const hqTerritories: Territory[] = [
  {
    ...base,
    id: tid(11),
    parentId: tid(4),
    level: 'headquarter',
    code: 'HQ-KOLN',
    name: 'Kolkata North HQ',
    path: `${tid(1)}.${tid(2)}.${tid(3)}.${tid(4)}.${tid(11)}`,
    centroid: null,
  },
  {
    ...base,
    id: tid(12),
    parentId: tid(4),
    level: 'headquarter',
    code: 'HQ-HWH',
    name: 'Howrah HQ',
    path: `${tid(1)}.${tid(2)}.${tid(3)}.${tid(4)}.${tid(12)}`,
    centroid: null,
  },
];

export const roles: Role[] = ROLE_KEYS.map((key, i) => ({
  id: `01930000-0000-7000-8000-0000000002${String(i).padStart(2, '0')}`,
  key,
  name: ROLE_NAMES[key],
  rank: ROLE_RANK[key],
  inHierarchy: ROLE_RANK[key] > 0,
  permissions: DEFAULT_ROLE_PERMISSIONS[key],
}));

export const me: Me = {
  id: '01930000-0000-7000-8000-000000000301',
  companyId: COMPANY_ID,
  companyName: 'Arighna Pharmaceutical (demo)',
  email: 'director@demo.ariforce.in',
  name: 'Demo Director',
  employeeCode: 'DIR001',
  roles: ['director'],
  permissions: DEFAULT_ROLE_PERMISSIONS.director,
  territoryIds: [tid(1)],
  managerId: null,
};

/** Mock personas (one per role), selected by `x-mock-user: <key|email|local-part>` or a `mock:<key>` session token. */
const PERSONAS: { key: (typeof ROLE_KEYS)[number]; local: string; code: string; t: number[] }[] = [
  { key: 'director', local: 'director', code: 'DIR001', t: [1] },
  { key: 'vice_president', local: 'vp', code: 'VP001', t: [1] },
  { key: 'general_manager', local: 'gm', code: 'GM001', t: [1] },
  { key: 'sales_manager', local: 'sm', code: 'SM001', t: [1] },
  { key: 'zonal_business_manager', local: 'zbm', code: 'ZBM001', t: [2] },
  { key: 'regional_business_manager', local: 'rbm', code: 'RBM001', t: [3] },
  { key: 'area_business_manager', local: 'abm', code: 'ABM001', t: [4] },
  { key: 'business_manager', local: 'bm', code: 'BM001', t: [4] },
  { key: 'system_admin', local: 'sysadmin', code: 'SYS001', t: [] },
  { key: 'distribution_head', local: 'dh', code: 'DH001', t: [] },
  { key: 'accountant', local: 'accountant', code: 'ACC001', t: [] },
];
const uid = (i: number) => `01930000-0000-7000-8000-000000000${301 + i}`;
const idOf = (k: string) => uid(PERSONAS.findIndex((p) => p.key === k));
/** The real chain is BM -> ABM -> RBM -> Director; ZBM, SM, GM and VP exist but nobody reports to them. */
const managerOf = (k: (typeof ROLE_KEYS)[number]): string | null =>
  k === 'business_manager'
    ? idOf('area_business_manager')
    : k === 'area_business_manager'
      ? idOf('regional_business_manager')
      : k === 'director' || ROLE_RANK[k] === 0
        ? null
        : idOf('director');
export const mockUsers: Me[] = PERSONAS.map((p, i) => ({
  ...me,
  id: uid(i),
  email: `${p.local}@demo.ariforce.in`,
  name: `Demo ${ROLE_NAMES[p.key]}`,
  employeeCode: p.code,
  roles: [p.key],
  permissions: DEFAULT_ROLE_PERMISSIONS[p.key],
  territoryIds: p.t.map(tid),
  managerId: managerOf(p.key),
}));
export function findMockUser(s: string | null | undefined): Me | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  return mockUsers.find(
    (u) => u.roles[0] === v || u.email === v || u.email.split('@')[0] === v || u.id === v,
  );
}

export const specialties: Specialty[] = [
  { ...base, id: '01930000-0000-7000-8000-000000000401', code: 'GP', name: 'General Physician' },
  { ...base, id: '01930000-0000-7000-8000-000000000402', code: 'CARD', name: 'Cardiologist' },
];
export const doctorCategories: DoctorCategory[] = [
  {
    ...base,
    id: '01930000-0000-7000-8000-000000000501',
    code: 'A',
    name: 'Core (A)',
    visitsPerMonth: 4,
  },
  {
    ...base,
    id: '01930000-0000-7000-8000-000000000502',
    code: 'B',
    name: 'Regular (B)',
    visitsPerMonth: 2,
  },
];
const addr = {
  addressLine: 'Shyambazar',
  city: 'Kolkata',
  state: 'West Bengal',
  pincode: '700004',
  location: { lat: 22.6, lng: 88.37 },
  phone: null,
};
export const doctors: Doctor[] = [
  {
    ...base,
    ...addr,
    id: '01930000-0000-7000-8000-000000000601',
    territoryId: tid(4),
    localTerritoryId: null,
    name: 'Dr. A. Sen',
    qualification: 'MBBS, MD',
    specialtyId: specialties[1]!.id,
    categoryId: doctorCategories[0]!.id,
    registrationNo: 'WBMC-12345',
    approvalStatus: 'approved',
  },
];
export const chemists: Chemist[] = [
  {
    ...base,
    ...addr,
    id: '01930000-0000-7000-8000-000000000701',
    territoryId: tid(4),
    localTerritoryId: null,
    name: 'Sen Medical Hall',
    gstin: null,
    drugLicenseNo: 'WB/KOL/20B-1',
  },
];
export const stockists: Stockist[] = [
  {
    ...base,
    ...addr,
    id: '01930000-0000-7000-8000-000000000801',
    territoryId: tid(3),
    name: 'Bengal Pharma Distributors',
    gstin: '19ABCDE1234F1Z5',
    drugLicenseNo: 'WB/KOL/21B-9',
  },
];

// ---- Products, work types, field data ----
const fid = (block: number, n: number) =>
  `01930000-0000-7000-8000-000000000${block}${String(n).padStart(2, '0')}`;
export const divisions: Division[] = [
  { ...base, id: fid(9, 1), code: 'CARDIO', name: 'Cardio-Diabetic', active: true },
  { ...base, id: fid(9, 2), code: 'GEN', name: 'General Care', active: true },
];
export const products: Product[] = [
  {
    ...base,
    id: fid(9, 11),
    divisionId: fid(9, 1),
    code: 'ARI-ATV10',
    name: 'Atorvastatin 10 mg',
    displayName: 'Atorvastatin',
    brand: 'Arilip',
    composition: 'Atorvastatin 10 mg',
    packSize: '10 x 10 tablets',
    form: 'tablet',
    mrp: 120,
    ptr: 96,
    pts: 86.4,
    isSample: true,
    active: true,
    imageFileKey: null,
    imageUrl: null,
  },
  {
    ...base,
    id: fid(9, 12),
    divisionId: fid(9, 2),
    code: 'ARI-PCM650',
    name: 'Paracetamol 650 mg',
    displayName: 'Paracetamol',
    brand: 'Arifev',
    composition: 'Paracetamol 650 mg',
    packSize: '15 tablets',
    form: 'tablet',
    mrp: 30,
    ptr: 24,
    pts: 21.6,
    isSample: false,
    active: true,
    imageFileKey: null,
    imageUrl: null,
  },
];
export const productHqMappings: ProductHqMapping[] = [
  { ...base, id: fid(9, 21), territoryId: tid(4), divisionId: fid(9, 1), productId: null },
];
export const workTypes: WorkType[] = [
  {
    ...base,
    id: fid(9, 31),
    code: 'FIELD',
    name: 'Field work',
    kind: 'field',
    requiresCalls: true,
    active: true,
  },
  {
    ...base,
    id: fid(9, 32),
    code: 'MEET',
    name: 'Meeting',
    kind: 'non_field',
    requiresCalls: false,
    active: true,
  },
  {
    ...base,
    id: fid(9, 33),
    code: 'LEAVE',
    name: 'Leave',
    kind: 'leave',
    requiresCalls: false,
    active: true,
  },
];
/** companies.dcr_lock_after_hours */
export const dcrLockAfterHours = 24;
export const geofence: GeofenceSettings = {
  radiusM: 150,
  maxAccuracyM: 100,
  blockOutOfFence: false,
  blockMockLocation: true,
  presentationRadiusM: 300,
  lockMaxAccuracyM: 80,
  version: 1,
};
export const consentState: ConsentState = {
  deviceId: fid(9, 41),
  ownership: 'company',
  currentNoticeVersion: '2026-10-v1',
  noticeUrl: '/legal/dpdp-notice/2026-10-v1',
  consents: [{ purpose: 'location_checkin', granted: true, noticeVersion: '2026-10-v1', at: now }],
  canCheckIn: true,
};
export const approvals: Approval[] = [
  {
    id: fid(9, 51),
    companyId: COMPANY_ID,
    subjectType: 'tour_plan',
    subjectId: fid(9, 61),
    requestedBy: '01930000-0000-7000-8000-000000000302',
    requestedByName: 'Demo Business Manager',
    approverId: me.id,
    status: 'pending',
    summary: 'Tour plan 2026-12 (demo BM)',
    comment: null,
    createdAt: now,
    decidedAt: null,
    decidedBy: null,
  },
];
