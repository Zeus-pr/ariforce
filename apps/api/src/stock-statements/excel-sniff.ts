const EXCEL_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  'application/excel',
  'application/x-excel',
  'application/x-msexcel',
  'application/vnd.ms-office',
]);

function at(b: Uint8Array, sig: number[]) {
  return b.length >= sig.length && sig.every((x, i) => b[i] === x);
}

function hasAscii(b: Uint8Array, text: string) {
  const needle = [...text].map((c) => c.charCodeAt(0));
  for (let i = 0; i <= b.length - needle.length; i++) {
    if (needle.every((x, j) => b[i + j] === x)) return true;
  }
  return false;
}

function hasUtf16(b: Uint8Array, text: string) {
  const needle = [...text].flatMap((c) => [c.charCodeAt(0), 0]);
  for (let i = 0; i <= b.length - needle.length; i++) {
    if (needle.every((x, j) => b[i + j] === x)) return true;
  }
  return false;
}

/** A zip that merely starts with PK is not a spreadsheet. Word and other Office files are zips too. */
export function excelContentMatches(type: string, b: Uint8Array) {
  if (!EXCEL_TYPES.has(type)) return false;
  const zip =
    at(b, [0x50, 0x4b, 0x03, 0x04]) ||
    at(b, [0x50, 0x4b, 0x05, 0x06]) ||
    at(b, [0x50, 0x4b, 0x07, 0x08]);
  const ole = at(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (zip) return hasAscii(b, 'xl/workbook') || hasAscii(b, 'xl/worksheets');
  if (ole) return hasUtf16(b, 'Workbook');
  return false;
}
