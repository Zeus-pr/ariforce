import { describe, expect, it } from 'vitest';
import { buildStatementRows, statementTotals, type StatementInput } from './statement';

const header = {
  userName: 'A',
  employeeCode: 'E1',
  designation: 'BM',
  region: null,
  hq: null,
  division: null,
  joinedOn: null,
  managerName: null,
  managerCode: null,
  phone: null,
  email: null,
  company: 'Co',
  status: 'Claim Applied',
};

const input = (over: Partial<StatementInput> = {}): StatementInput => ({
  month: '2026-05',
  header,
  dcrs: [],
  lines: [],
  leaves: [],
  weeklyOffDays: [0],
  ...over,
});

describe('buildStatementRows', () => {
  it('emits one row per calendar day, marking weekly off and leave', () => {
    const rows = buildStatementRows(
      input({ leaves: [{ from: '2026-05-04', to: '2026-05-04', policy: 'Casual Leave' }] }),
    );
    expect(rows).toHaveLength(31);
    expect(rows.find((r) => r.date === '2026-05-03')?.activity).toBe('Sunday');
    expect(rows.find((r) => r.date === '2026-05-04')?.activity).toBe('Leave (Casual Leave)');
    expect(rows.find((r) => r.date === '2026-05-05')?.activity).toBe('-');
  });

  it('keeps several reports of one day and counts the money once', () => {
    const dcr = {
      workTypeName: 'Field',
      workTypeKind: 'field' as const,
      status: 'approved',
      band: 'ex_hq' as const,
      places: ['Bolpur'],
      routes: ['A TO B (BIKE)'],
      distanceKm: 222,
      doctorsMet: 5,
      accompanists: 1,
    };
    const rows = buildStatementRows(
      input({
        dcrs: [
          { ...dcr, date: '2026-05-06' },
          {
            ...dcr,
            date: '2026-05-06',
            workTypeName: 'Camp',
            workTypeKind: 'non_field',
            band: null,
          },
        ],
        lines: [
          { date: '2026-05-06', category: 'travel', amount: 610.5, notes: 'OK', mileageKm: null },
          { date: '2026-05-06', category: 'allowance', amount: 300, notes: null, mileageKm: null },
          { date: '2026-05-06', category: 'courier', amount: 50, notes: 'DTDC', mileageKm: null },
          { date: '2026-05-06', category: 'food', amount: 100, notes: null, mileageKm: null },
        ],
      }),
    );
    const day = rows.filter((r) => r.date === '2026-05-06');
    expect(day).toHaveLength(2);
    expect(day[0]).toMatchObject({ activity: 'Field', category: 'EX HQ', total: 1060.5 });
    expect(day[0]!.money).toMatchObject({ ta: 610.5, da: 300, courier: 50, other: 100 });
    expect(day[0]!.remarks).toBe('OK, DTDC');
    expect(day[1]!.total).toBe(0);
    const t = statementTotals(rows);
    expect(t.total).toBe(1060.5);
    expect(t.doctorsMet).toBe(10);
  });
});
