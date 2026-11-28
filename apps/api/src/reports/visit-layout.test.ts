import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { visitLines, visitSheets, type OutletCard, type VisitCall } from './visit-layout';
import { visitXlsx } from './visit-xlsx';

const doctor: OutletCard = {
  id: 'd1',
  kind: 'doctor',
  hqId: 'hq',
  name: 'Dr Sen',
  code: 'ARIDOC000001',
  specialty: 'Physician',
  category: 'A',
  qualification: 'MBBS',
  territory: 'Amta',
  city: 'Howrah',
  phone: '9000000000',
  required: 3,
};

const chemist: OutletCard = {
  ...doctor,
  id: 'c1',
  kind: 'chemist',
  name: 'Amta Medical',
  code: 'ARICHM000001',
  specialty: '',
  category: '',
  qualification: '',
  required: null,
};

const call = (over: Partial<VisitCall>): VisitCall => ({
  userId: 'u1',
  visitor: 'Dibyendu',
  kind: 'doctor',
  outletId: 'd1',
  date: '2026-11-03',
  ...over,
});

describe('visit breakdown', () => {
  it('keeps every visit, including two on the same day, under the headquarters', () => {
    const lines = visitLines(
      [
        call({}),
        call({ date: '2026-11-03' }),
        call({ date: '2026-11-12' }),
        call({ kind: 'chemist', outletId: 'c1', date: '2026-11-04' }),
      ],
      [doctor, chemist],
    );
    const sheet = visitSheets([{ id: 'hq', name: 'Howrah' }], lines, {})[0]!;
    expect(sheet.lines.map((line) => line.name)).toEqual(['Dr Sen', 'Amta Medical']);
    expect(sheet.lines[0]).toMatchObject({
      times: 3,
      dates: ['2026-11-03', '2026-11-03', '2026-11-12'],
      required: 3,
      visitor: 'Dibyendu',
    });
  });

  it('writes a cover and one sheet per headquarters', async () => {
    const lines = visitLines([call({})], [doctor]);
    const buf = await visitXlsx({
      company: 'ARIGHNA PHARMA PVT. LTD.',
      preparedFor: 'Rupam',
      monthLabel: 'November 2026',
      monthKey: '2026-11',
      generatedAt: '28 Nov 2026',
      sheets: visitSheets([{ id: 'hq', name: 'Howrah' }], lines, {}),
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual(['Cover', 'Howrah', 'Definitions']);
    expect(wb.getWorksheet('Cover')!.getCell('A1').value).toBe('Doc / chem visit breakdown');
    const howrah = wb.getWorksheet('Howrah')!;
    expect(howrah.getCell('A6').value).toBe('Doctor');
    expect(howrah.getCell('B6').value).toBe('Dr Sen');
    expect(howrah.getCell('K6').value).toBe(1);
    expect(howrah.getCell('M6').value).toBe('3 Nov');
  });
});
