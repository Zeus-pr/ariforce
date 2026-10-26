import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as s from '../src/schema';
import { DEMO_COMPANY_ID as C, ROLE_DEFS, T, U, roleId, seedIds } from '../src/seed-data';

const url = process.env.DIRECT_URL;
if (!url) throw new Error('DIRECT_URL (direct owner connection, migrations only) is required');
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema: s });

const BASE = ['me:read', 'roles:read', 'territories:read', 'masters:read'];
const MANAGER = [
  ...BASE,
  'users:read',
  'masters:write',
  'field:read',
  'approvals:decide',
  'reports:read',
];
/** Mirrors DEFAULT_ROLE_PERMISSIONS in @ariforce/contracts. */
const PERMS: Record<string, string[]> = {
  business_manager: [...BASE, 'masters:write', 'field:read', 'field:write', 'reports:read'],
  area_business_manager: MANAGER,
  regional_business_manager: MANAGER,
  zonal_business_manager: MANAGER,
  sales_manager: MANAGER,
  general_manager: MANAGER,
  vice_president: MANAGER,
  director: [...MANAGER, 'imports:write', 'settings:write', 'audit:read'],
  system_admin: [
    ...BASE,
    'territories:write',
    'users:read',
    'users:write',
    'masters:write',
    'imports:write',
    'settings:write',
    'audit:read',
  ],
  distribution_head: ['me:read', 'roles:read', 'territories:read', 'sales:read'],
  accountant: ['me:read', 'roles:read', 'territories:read', 'finance:read'],
};

await db.transaction(async (tx) => {
  await tx
    .insert(s.companies)
    .values({ id: C, name: 'Arighna Pharmaceutical (demo)', slug: 'demo' })
    .onConflictDoNothing();
  await tx
    .insert(s.roles)
    .values(
      ROLE_DEFS.map((r, i) => ({
        id: roleId(i),
        companyId: C,
        key: r.key,
        name: r.name,
        rank: r.rank,
        permissions: PERMS[r.key]!,
      })),
    )
    .onConflictDoNothing();
  const terr = [
    {
      id: T.national,
      parentId: null,
      level: 'national',
      code: 'IN',
      name: 'India',
      path: T.national,
    },
    {
      id: T.zone,
      parentId: T.national,
      level: 'zone',
      code: 'EZ',
      name: 'East Zone',
      path: `${T.national}.${T.zone}`,
    },
    {
      id: T.region,
      parentId: T.zone,
      level: 'region',
      code: 'WB',
      name: 'West Bengal',
      path: `${T.national}.${T.zone}.${T.region}`,
    },
    {
      id: T.area,
      parentId: T.region,
      level: 'area',
      code: 'KOL-N',
      name: 'Kolkata North',
      path: `${T.national}.${T.zone}.${T.region}.${T.area}`,
    },
    {
      id: T.hq,
      parentId: T.area,
      level: 'headquarter',
      code: 'KOL-N-HQ1',
      name: 'Shyambazar HQ',
      path: `${T.national}.${T.zone}.${T.region}.${T.area}.${T.hq}`,
      centroid: { x: 88.37, y: 22.6 },
    },
    {
      id: T.otherArea,
      parentId: T.region,
      level: 'area',
      code: 'KOL-S',
      name: 'Kolkata South',
      path: `${T.national}.${T.zone}.${T.region}.${T.otherArea}`,
    },
  ] as const;
  await tx
    .insert(s.territories)
    .values(terr.map((t) => ({ ...t, companyId: C })))
    .onConflictDoNothing();

  // One user per hierarchy role (reporting line via manager_id) plus the system admin.
  // role = index into ROLE_DEFS.
  const people = [
    {
      id: U.sysadmin,
      email: 'sysadmin@demo.ariforce.in',
      name: 'Sam System Admin',
      code: 'SYS001',
      role: 5,
      terr: T.national,
      mgr: null,
    },
    {
      id: U.director,
      email: 'director@demo.ariforce.in',
      name: 'Dipa Director',
      code: 'DIR001',
      role: 4,
      terr: T.national,
      mgr: null,
    },
    {
      id: U.vp,
      email: 'vp@demo.ariforce.in',
      name: 'Vikram VP',
      code: 'VP001',
      role: 8,
      terr: T.national,
      mgr: U.director,
    },
    {
      id: U.gm,
      email: 'gm@demo.ariforce.in',
      name: 'Gita GM',
      code: 'GM001',
      role: 7,
      terr: T.national,
      mgr: U.vp,
    },
    {
      id: U.sm,
      email: 'sm@demo.ariforce.in',
      name: 'Sanjay Sales Manager',
      code: 'SM001',
      role: 6,
      terr: T.national,
      mgr: U.gm,
    },
    {
      id: U.zonal,
      email: 'zbm@demo.ariforce.in',
      name: 'Zubin ZBM',
      code: 'ZBM001',
      role: 3,
      terr: T.zone,
      mgr: U.sm,
    },
    {
      id: U.regional,
      email: 'rbm@demo.ariforce.in',
      name: 'Rina RBM',
      code: 'RBM001',
      role: 2,
      terr: T.region,
      mgr: U.zonal,
    },
    {
      id: U.area,
      email: 'abm@demo.ariforce.in',
      name: 'Arup ABM',
      code: 'ABM001',
      role: 1,
      terr: T.area,
      mgr: U.regional,
    },
    {
      id: U.rep,
      email: 'bm@demo.ariforce.in',
      name: 'Riya BM',
      code: 'BM001',
      role: 0,
      terr: T.hq,
      mgr: U.area,
    },
    {
      id: U.otherRep,
      email: 'bm2@demo.ariforce.in',
      name: 'Sourav BM',
      code: 'BM002',
      role: 0,
      terr: T.otherArea,
      mgr: U.regional,
    },
    // Outside the hierarchy: no manager, no territory (domain-wide read via permissions).
    {
      id: U.dh,
      email: 'dh@demo.ariforce.in',
      name: 'Dev Distribution Head',
      code: 'DH001',
      role: 9,
      terr: null,
      mgr: null,
    },
    {
      id: U.accountant,
      email: 'accountant@demo.ariforce.in',
      name: 'Anita Accountant',
      code: 'ACC001',
      role: 10,
      terr: null,
      mgr: null,
    },
  ];
  await tx
    .insert(s.users)
    .values(
      people.map((p) => ({
        id: p.id,
        companyId: C,
        email: p.email,
        name: p.name,
        employeeCode: p.code,
        managerId: p.mgr,
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(s.userRoles)
    .values(people.map((p) => ({ companyId: C, userId: p.id, roleId: roleId(p.role) })))
    .onConflictDoNothing();
  await tx
    .insert(s.userTerritories)
    .values(
      people.flatMap((p) => (p.terr ? [{ companyId: C, userId: p.id, territoryId: p.terr }] : [])),
    )
    .onConflictDoNothing();

  const { id } = seedIds;
  await tx
    .insert(s.specialties)
    .values([
      { id: id('4', 1), companyId: C, code: 'GP', name: 'General Physician' },
      { id: id('4', 2), companyId: C, code: 'CARD', name: 'Cardiologist' },
    ])
    .onConflictDoNothing();
  await tx
    .insert(s.doctorCategories)
    .values([
      { id: id('5', 1), companyId: C, code: 'A', name: 'Grade A', visitsPerCycle: 3 },
      { id: id('5', 2), companyId: C, code: 'B', name: 'Grade B', visitsPerCycle: 2 },
      { id: id('5', 3), companyId: C, code: 'C', name: 'Grade C', visitsPerCycle: 1 },
    ])
    .onConflictDoNothing();
  await tx
    .insert(s.workTypes)
    .values([
      {
        id: id('9', 1),
        companyId: C,
        code: 'FW-HQ',
        name: 'Field work (HQ)',
        kind: 'field',
        countsAsFieldDay: true,
        allowanceBand: 'hq',
        requiresLocation: true,
      },
      {
        id: id('9', 2),
        companyId: C,
        code: 'FW-EXHQ',
        name: 'Field work (ex-HQ)',
        kind: 'field',
        countsAsFieldDay: true,
        allowanceBand: 'ex_hq',
        requiresLocation: true,
      },
      {
        id: id('9', 3),
        companyId: C,
        code: 'FW-OS',
        name: 'Field work (outstation)',
        kind: 'field',
        countsAsFieldDay: true,
        allowanceBand: 'outstation',
        requiresLocation: true,
      },
      { id: id('9', 4), companyId: C, code: 'MEET', name: 'Meeting', kind: 'non_field' },
      { id: id('9', 5), companyId: C, code: 'TRANSIT', name: 'Transit', kind: 'non_field' },
      { id: id('9', 6), companyId: C, code: 'LEAVE', name: 'Leave', kind: 'leave' },
      { id: id('9', 7), companyId: C, code: 'HOLIDAY', name: 'Holiday', kind: 'holiday' },
    ])
    .onConflictDoNothing();
  const addr = { city: 'Kolkata', state: 'West Bengal', pincode: '700004' };
  await tx
    .insert(s.doctors)
    .values([
      {
        id: id('6', 1),
        companyId: C,
        territoryId: T.hq,
        name: 'Dr. A. Sen',
        qualification: 'MBBS, MD',
        specialtyId: id('4', 2),
        categoryId: id('5', 1),
        registrationNo: 'WBMC-12345',
        location: { x: 88.3712, y: 22.6011 },
        geofenceRadiusM: 100,
        ...addr,
      },
      {
        id: id('6', 2),
        companyId: C,
        territoryId: T.otherArea,
        name: 'Dr. B. Roy',
        qualification: 'MBBS',
        specialtyId: id('4', 1),
        categoryId: id('5', 2),
        ...addr,
      },
    ])
    .onConflictDoNothing();
  await tx
    .insert(s.chemists)
    .values([
      {
        id: id('7', 1),
        companyId: C,
        territoryId: T.hq,
        name: 'Sen Medical Hall',
        drugLicenseNo: 'WB/KOL/20B-1',
        ...addr,
      },
    ])
    .onConflictDoNothing();
  await tx
    .insert(s.stockists)
    .values([
      {
        id: id('8', 1),
        companyId: C,
        territoryId: T.region,
        name: 'Bengal Pharma Distributors',
        gstin: '19ABCDE1234F1Z5',
        ...addr,
      },
    ])
    .onConflictDoNothing();
});
await pool.end();
console.log('seeded demo company');
