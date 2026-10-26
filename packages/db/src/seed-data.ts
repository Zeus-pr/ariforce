/** Deterministic demo tenant (ids stable so tests and mocks can reference them). */
export const DEMO_COMPANY_ID = '01930000-0000-7000-8000-000000000001';
const id = (block: string, n: number) =>
  `01930000-0000-7000-8000-${block}${String(n).padStart(12 - block.length, '0')}`;

/** Index = roleId(i). Rank 1..8 = sales hierarchy; 0 = system_admin (no reporting line). */
export const ROLE_DEFS = [
  { key: 'business_manager', name: 'Business Manager', rank: 1 },
  { key: 'area_business_manager', name: 'Area Business Manager', rank: 2 },
  { key: 'regional_business_manager', name: 'Regional Business Manager', rank: 3 },
  { key: 'zonal_business_manager', name: 'Zonal Business Manager', rank: 4 },
  { key: 'director', name: 'Director', rank: 8 },
  { key: 'system_admin', name: 'System Admin', rank: 0 },
  { key: 'sales_manager', name: 'Sales Manager', rank: 5 },
  { key: 'general_manager', name: 'General Manager', rank: 6 },
  { key: 'vice_president', name: 'Vice President', rank: 7 },
  { key: 'distribution_head', name: 'Distribution Head', rank: 0 },
  { key: 'accountant', name: 'Accountant', rank: 0 },
] as const;

export const T = {
  national: id('1', 1),
  zone: id('1', 2),
  region: id('1', 3),
  area: id('1', 4),
  hq: id('1', 5),
  otherArea: id('1', 6),
};

export const U = {
  sysadmin: id('3', 1),
  director: id('3', 2),
  zonal: id('3', 3),
  regional: id('3', 4),
  area: id('3', 5),
  rep: id('3', 6),
  otherRep: id('3', 7),
  vp: id('3', 8),
  gm: id('3', 9),
  sm: id('3', 10),
  dh: id('3', 11),
  accountant: id('3', 12),
};

export const roleId = (i: number) => id('2', i + 1);
export const seedIds = { id };
