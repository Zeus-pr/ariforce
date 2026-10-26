/** Deterministic demo tenant (ids stable so tests and mocks can reference them). */
export const DEMO_COMPANY_ID = '01930000-0000-7000-8000-000000000001';
const id = (block: string, n: number) =>
  `01930000-0000-7000-8000-${block}${String(n).padStart(12 - block.length, '0')}`;

export const ROLE_DEFS = [
  { key: 'rep', name: 'Medical Representative', rank: 1 },
  { key: 'area_manager', name: 'Area Manager', rank: 2 },
  { key: 'regional_manager', name: 'Regional Manager', rank: 3 },
  { key: 'zonal_manager', name: 'Zonal Manager', rank: 4 },
  { key: 'national_head', name: 'National Head', rank: 5 },
  { key: 'admin', name: 'Admin', rank: 6 },
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
  admin: id('3', 1),
  national: id('3', 2),
  zonal: id('3', 3),
  regional: id('3', 4),
  area: id('3', 5),
  rep: id('3', 6),
  otherRep: id('3', 7),
};

export const roleId = (i: number) => id('2', i + 1);
export const seedIds = { id };
