import { inflateRawSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { toPdf } from './export.util';
import type { StatementInput } from './statement';

const header = {
  userName: 'Sayak Kar',
  employeeCode: 'LE279822',
  designation: 'BM',
  region: 'Burdwan',
  hq: 'Bardhaman',
  division: 'Imperia',
  joinedOn: '2022-04-21',
  managerName: 'Chayan Sarkar',
  managerCode: 'LE276322',
  phone: '8116358582',
  email: 'sayakkar083@gmail.com',
  company: 'Arighna',
  status: 'Claim Applied',
};

const input: StatementInput = {
  month: '2026-05',
  header,
  dcrs: [
    {
      date: '2026-05-02',
      workTypeName: 'Field',
      workTypeKind: 'field',
      status: 'approved',
      band: 'hq',
      places: ['Bardhaman'],
      routes: ['BARDHAMAN (BIKE)'],
      distanceKm: 0,
      doctorsMet: 7,
      accompanists: 0,
    },
  ],
  lines: [
    { date: '2026-05-02', category: 'allowance', amount: 300, notes: null, mileageKm: null },
    { date: '2026-05-07', category: 'courier', amount: 40, notes: 'DTDC', mileageKm: null },
  ],
  leaves: [],
  weeklyOffDays: [0],
};

function textOf(pdf: Buffer) {
  const chunks: string[] = [];
  const raw = pdf.toString('latin1');
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>/g))
    chunks.push(Buffer.from(m[1]!, 'hex').toString('latin1'));
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const m of raw.matchAll(re)) {
    const body = Buffer.from(m[1]!, 'latin1');
    for (const fn of [inflateSync, inflateRawSync]) {
      try {
        const text = fn(body).toString('latin1');
        for (const h of text.matchAll(/<([0-9A-Fa-f]+)>/g))
          chunks.push(Buffer.from(h[1]!, 'hex').toString('latin1'));
        break;
      } catch {
        // Already plain, or a different filter.
      }
    }
  }
  return chunks.join('');
}

describe('toPdf', () => {
  it('prints the day-by-day statement with the logo, not the old summary', async () => {
    const buf = await toPdf('2026-05', [input]);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = textOf(buf);
    expect(text).toContain('Expense Claim Report');
    expect(text).toContain('Sayak Kar');
    expect(text).toContain('LE279822');
    expect(text).toContain('Chayan Sarkar');
    expect(text).toContain('BARDHAMAN (BIKE)');
    expect(text).toContain('DTDC');
    expect(text).not.toContain('Flagged days');
    expect(text).not.toContain('Unmatched');
  });

  it('still returns a PDF when the month has no claims', async () => {
    const buf = await toPdf('2026-05', []);
    expect(textOf(buf)).toContain('No claims for this month.');
  });
});
