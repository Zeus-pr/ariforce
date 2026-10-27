/**
 * SAMPLE ORG for the local team adapter. Names are invented; phones and emails are fake
 * (98300 0xxxx, @demo.ariforce.test). HQs follow Arighna's West Bengal HQ list. No payroll data.
 */
import type { SalesRole } from '@/lib/roles';
import type { Employee, Hq } from './types';

export const HQS: Hq[] = [
  ['kol-dunlop', 'Kolkata-Dunlop', 'Kolkata'],
  ['barasat', 'Barasat', 'Barasat'],
  ['howrah', 'Howrah', 'Howrah'],
  ['burdwan', 'Burdwan', 'Bardhaman'],
  ['durgapur', 'Durgapur', 'Durgapur'],
  ['asansol', 'Asansol', 'Asansol'],
  ['bankura', 'Bankura', 'Bankura'],
  ['suri', 'Suri', 'Suri'],
  ['malda', 'Malda', 'English Bazar'],
].map(([id, name, city]) => ({ id: `hq-${id}`, name: name!, city: city!, state: 'West Bengal' }));

let n = 0;
const emp = (
  name: string,
  role: SalesRole,
  hq: string | null,
  managerId: string | null,
  id?: string,
): Employee => {
  n += 1;
  const code = `ARI${String(1000 + n)}`;
  return {
    id: id ?? `emp-${n}`,
    name,
    role,
    employeeCode: code,
    phone: `+91 98300 ${String(10000 + n * 37).slice(-5)}`,
    email: `${name
      .toLowerCase()
      .replace(/[^a-z]+/g, '.')
      .replace(/\.$/, '')}@demo.ariforce.test`,
    hqId: hq ? `hq-${hq}` : null,
    managerId,
    active: true,
  };
};

/** Director → VP → GM → SM → ZBM → 2 RBMs → 4 ABMs → 9 BMs, plus people with no manager yet. */
export function seedOrg(): Employee[] {
  n = 0;
  const INVITED = new Set(['Riya Sarkar', 'Moumita Halder', 'Pritam Bose', 'Debarati Nandi']);
  const done = (list: Employee[]) => list.map((e) => (INVITED.has(e.name) ? { ...e, invited: true } : e));
  const dir = emp('Arindam Basu', 'director', 'kol-dunlop', null, 'org-director');
  const vp = emp('Sanjay Mitra', 'vice_president', 'kol-dunlop', dir.id, 'org-vp');
  const gm = emp('Debashis Roy', 'general_manager', 'kol-dunlop', vp.id, 'org-gm');
  const sm = emp('Partha Sen', 'sales_manager', 'kol-dunlop', gm.id, 'org-sm');
  const zbm = emp('Kaushik Ghosh', 'zonal_business_manager', 'kol-dunlop', sm.id, 'org-zbm');
  const rbmS = emp('Subhajit Das', 'regional_business_manager', 'kol-dunlop', zbm.id, 'org-rbm');
  const rbmN = emp('Amitava Paul', 'regional_business_manager', 'durgapur', zbm.id);
  const abmK = emp('Rahul Chatterjee', 'area_business_manager', 'kol-dunlop', rbmS.id, 'org-abm');
  const abmH = emp('Sourav Mondal', 'area_business_manager', 'howrah', rbmS.id);
  const abmD = emp('Tanmoy Banerjee', 'area_business_manager', 'durgapur', rbmN.id);
  const abmM = emp('Prosenjit Saha', 'area_business_manager', 'malda', rbmN.id);
  return done([
    dir,
    vp,
    gm,
    sm,
    zbm,
    rbmS,
    rbmN,
    abmK,
    abmH,
    abmD,
    abmM,
    emp('Ankit Dey', 'business_manager', 'kol-dunlop', abmK.id, 'org-bm'),
    emp('Riya Sarkar', 'business_manager', 'barasat', abmK.id),
    emp('Biswajit Pal', 'business_manager', 'howrah', abmH.id),
    emp('Moumita Halder', 'business_manager', 'burdwan', abmH.id),
    emp('Sayan Majumdar', 'business_manager', 'durgapur', abmD.id),
    emp('Arijit Kundu', 'business_manager', 'asansol', abmD.id),
    emp('Pritam Bose', 'business_manager', 'bankura', abmD.id),
    emp('Soumen Mandal', 'business_manager', 'suri', abmM.id),
    emp('Nilanjan Sinha', 'business_manager', 'malda', abmM.id),
    // Reporting lines not in the data yet.
    emp('Debarati Nandi', 'business_manager', 'barasat', null),
    emp('Rajib Biswas', 'business_manager', 'bankura', null),
    emp('Sudip Karmakar', 'business_manager', 'suri', null),
    emp('Abhishek Guha', 'area_business_manager', 'burdwan', null),
  ]);
}

/** Where each mock sign-in sits in the sample org. */
export const ME_BY_ROLE: Partial<Record<SalesRole, string>> = {
  director: 'org-director',
  vice_president: 'org-vp',
  general_manager: 'org-gm',
  sales_manager: 'org-sm',
  zonal_business_manager: 'org-zbm',
  regional_business_manager: 'org-rbm',
  area_business_manager: 'org-abm',
  business_manager: 'org-bm',
};
