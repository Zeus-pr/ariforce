import type {
  Chemist,
  Doctor,
  DoctorCategory,
  Me,
  Role,
  Specialty,
  Stockist,
  Territory,
} from '../index';
import { ROLE_KEYS, ROLE_RANK } from '../schemas/roles';

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

export const roles: Role[] = ROLE_KEYS.map((key, i) => ({
  id: `01930000-0000-7000-8000-0000000002${String(i).padStart(2, '0')}`,
  key,
  name: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  rank: ROLE_RANK[key],
  permissions:
    key === 'admin'
      ? [
          'me:read',
          'roles:read',
          'territories:read',
          'territories:write',
          'users:read',
          'users:write',
          'masters:read',
          'masters:write',
          'audit:read',
        ]
      : key === 'rep'
        ? ['me:read', 'roles:read', 'territories:read', 'masters:read', 'masters:write']
        : [
            'me:read',
            'roles:read',
            'territories:read',
            'users:read',
            'masters:read',
            'masters:write',
          ],
}));

export const me: Me = {
  id: '01930000-0000-7000-8000-000000000301',
  companyId: COMPANY_ID,
  companyName: 'Arighna Pharmaceutical (demo)',
  email: 'admin@demo.ariforce.in',
  name: 'Demo Admin',
  employeeCode: 'ADM001',
  roles: ['admin'],
  permissions: roles.find((r) => r.key === 'admin')!.permissions,
  territoryIds: [tid(1)],
  managerId: null,
};

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
    name: 'Dr. A. Sen',
    qualification: 'MBBS, MD',
    specialtyId: specialties[1]!.id,
    categoryId: doctorCategories[0]!.id,
    registrationNo: 'WBMC-12345',
  },
];
export const chemists: Chemist[] = [
  {
    ...base,
    ...addr,
    id: '01930000-0000-7000-8000-000000000701',
    territoryId: tid(4),
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
