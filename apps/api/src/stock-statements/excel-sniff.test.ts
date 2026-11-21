import { describe, expect, it } from 'vitest';
import { excelContentMatches } from './excel-sniff';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS = 'application/vnd.ms-excel';

function bytes(parts: number[]) {
  return new Uint8Array(parts);
}

describe('excel content', () => {
  it('accepts a spreadsheet zip and rejects a Word zip', () => {
    const header = [0x50, 0x4b, 0x03, 0x04];
    const sheet = bytes([...header, ...[...'xl/workbook'].map((c) => c.charCodeAt(0))]);
    const word = bytes([...header, ...[...'word/document.xml'].map((c) => c.charCodeAt(0))]);
    expect(excelContentMatches(XLSX, sheet)).toBe(true);
    expect(excelContentMatches(XLSX, word)).toBe(false);
  });

  it('accepts an old Excel file and rejects an OLE file that is not one', () => {
    const header = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    const workbook = [...'Workbook'].flatMap((c) => [c.charCodeAt(0), 0]);
    expect(excelContentMatches(XLS, bytes([...header, ...workbook]))).toBe(true);
    expect(excelContentMatches(XLS, bytes(header))).toBe(false);
  });
});
