import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as s from '../src/schema';
import { DEMO_COMPANY_ID as C, ROLE_DEFS, T, U, roleId, seedIds } from '../src/seed-data';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL (owner role) is required');
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema: s });

const PERMS: Record<string, string[]> = {
  rep: ['me:read', 'roles:read', 'territories:read', 'masters:read', 'masters:write'],
  manager: [
    'me:read',
    'roles:read',
    'territories:read',
    'users:read',
    'masters:read',
    'masters:write',
    'approvals:decide',
  ],
  admin: [
    'me:read',
    'roles:read',
    'territories:read',
    'territories:write',
    'users:read',
    'users:write',
    'masters:read',
    'masters:write',
    'approvals:decide',
    'audit:read',
    'settings:write',
  ],
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
        permissions: PERMS[r.key === 'rep' || r.key === 'admin' ? r.key : 'manager']!,
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

  const people = [
    {
      id: U.admin,
      email: 'admin@demo.ariforce.in',
      name: 'Demo Admin',
      code: 'ADM001',
      role: 5,
      terr: T.national,
      mgr: null,
    },
    {
      id: U.national,
      email: 'nsm@demo.ariforce.in',
      name: 'Nita National',
      code: 'NSM001',
      role: 4,
      terr: T.national,
      mgr: null,
    },
    {
      id: U.zonal,
      email: 'zsm@demo.ariforce.in',
      name: 'Zubin Zonal',
      code: 'ZSM001',
      role: 3,
      terr: T.zone,
      mgr: U.national,
    },
    {
      id: U.regional,
      email: 'rsm@demo.ariforce.in',
      name: 'Rina Regional',
      code: 'RSM001',
      role: 2,
      terr: T.region,
      mgr: U.zonal,
    },
    {
      id: U.area,
      email: 'abm@demo.ariforce.in',
      name: 'Arup Area',
      code: 'ABM001',
      role: 1,
      terr: T.area,
      mgr: U.regional,
    },
    {
      id: U.rep,
      email: 'rep@demo.ariforce.in',
      name: 'Riya Rep',
      code: 'MR001',
      role: 0,
      terr: T.hq,
      mgr: U.area,
    },
    {
      id: U.otherRep,
      email: 'rep2@demo.ariforce.in',
      name: 'Sourav Rep',
      code: 'MR002',
      role: 0,
      terr: T.otherArea,
      mgr: U.regional,
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
    .values(people.map((p) => ({ companyId: C, userId: p.id, territoryId: p.terr })))
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
