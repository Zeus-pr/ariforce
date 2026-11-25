import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  applySales,
  blankFigures,
  headquartersOf,
  patchesOf,
  sheetTab,
  sumPeople,
  type PersonLine,
  type Place,
} from './master-layout';
import { masterXlsx } from './master-xlsx';

const place = (id: string, name: string, level: string, parentId: string | null): Place => ({
  id,
  name,
  path: parentId ? `root.${parentId}.${id}` : `root.${id}`,
  level,
  parentId,
});

function person(name: string, visits: number): PersonLine {
  const figures = blankFigures();
  figures.doctorVisits = visits;
  figures.fieldDays = 2;
  figures.workingDays = 10;
  figures.msl = 4;
  return {
    name,
    code: '',
    role: '',
    manager: '',
    figures,
    submittedDays: 8,
    onTimeDays: 6,
    mslSeen: 3,
    frequencyMet: 2,
  };
}

describe('master excel layout', () => {
  const hq = place('hq', 'Kolkata', 'headquarter', 'area');
  const north = place('n', 'North', 'territory', 'hq');
  const south = place('s', 'South', 'territory', 'hq');

  it('lists headquarters and the territories under each', () => {
    const places = [south, hq, north, place('area', 'Area', 'area', null)];
    expect(headquartersOf(places).map((p) => p.name)).toEqual(['Kolkata']);
    expect(patchesOf(places, hq).map((p) => p.name)).toEqual(['North', 'South']);
  });

  it('keeps sheet tabs unique and free of characters Excel refuses', () => {
    const used = new Set<string>();
    expect(sheetTab('Kolkata/North', used)).toBe('Kolkata North');
    expect(sheetTab('Kolkata/North', used)).toBe('Kolkata North 2');
  });

  it('rebuilds call average from the people and keeps sales for a separate total', () => {
    const total = sumPeople([person('A', 10), person('B', 6)]);
    expect(total.callAverage).toBe(4);
    expect(total.coverage).toBe(75);
    const withSales = applySales(total, {
      primarySales: 80,
      primaryTarget: 100,
      primaryLy: 50,
      secondarySales: 0,
      secondaryTarget: null,
    });
    expect(withSales.primaryAchievement).toBe(80);
    expect(withSales.growth).toBe(60);
  });

  it('writes a cover, one sheet per headquarters, and the definitions', async () => {
    const figures = blankFigures();
    const buf = await masterXlsx({
      company: 'ARIGHNA PHARMA PVT. LTD.',
      preparedFor: 'Rupam',
      monthLabel: 'November 2026',
      monthKey: '2026-11',
      generatedAt: '25 Nov 2026, 4:00 pm',
      sheets: [
        {
          name: 'Kolkata',
          people: [person('Mina', 12)],
          patches: [{ name: 'North', figures }],
          total: figures,
        },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Cover', 'Kolkata', 'Definitions']);
    expect(wb.getWorksheet('Kolkata')?.getCell('A1').value).toBe('Kolkata');
  });
});
