import ExcelJS from 'exceljs';
import { sheetTab } from './master-layout';
import type { VisitFile, VisitLine, VisitSheet } from './visit-layout';

const NAVY = 'FF1B3A4B';
const SAND = 'FFF4EFE6';
const GOLD = 'FFF3E6C8';
const INK = 'FF1B3A4B';
const MUTED = 'FF5C6B73';
const WHITE = 'FFFFFFFF';
const LINE = 'FFD9D3C7';
const DOCTOR = 'FFE6F0F8';
const CHEMIST = 'FFE5F4F2';
const DOCTOR_BAND = 'FF1F4E79';

const WHO = [
  { header: 'Kind', width: 12 },
  { header: 'Name', width: 26 },
  { header: 'Code', width: 14 },
  { header: 'Specialty', width: 18 },
  { header: 'Category', width: 14 },
  { header: 'Qualification', width: 16 },
  { header: 'Territory', width: 18 },
  { header: 'City', width: 16 },
  { header: 'Phone', width: 16 },
];

const VISITS = [
  { header: 'Visited by', width: 22 },
  { header: 'Times', width: 10 },
  { header: 'Required', width: 12 },
  { header: 'Dates', width: 42 },
];

const LAST = WHO.length + VISITS.length;
const DATE = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function paint(cell: ExcelJS.Cell, argb: string, color = INK, bold = false) {
  cell.fill = fill(argb);
  cell.font = { name: 'Calibri', size: 11, color: { argb: color }, bold };
  cell.alignment = { vertical: 'middle', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: LINE } },
    left: { style: 'thin', color: { argb: LINE } },
    bottom: { style: 'thin', color: { argb: LINE } },
    right: { style: 'thin', color: { argb: LINE } },
  };
}

function dateLabel(iso: string) {
  return DATE.format(new Date(`${iso}T00:00:00Z`));
}

function writeLine(ws: ExcelJS.Worksheet, rowNo: number, line: VisitLine) {
  const row = ws.getRow(rowNo);
  row.height = 18;
  const base = line.kind === 'doctor' ? DOCTOR : CHEMIST;
  const values = [
    line.kind === 'doctor' ? 'Doctor' : 'Chemist',
    line.name,
    line.code,
    line.specialty,
    line.category,
    line.qualification,
    line.territory,
    line.city,
    line.phone,
    line.visitor,
    line.times,
    line.required,
    line.dates.map(dateLabel).join(', '),
  ];
  values.forEach((value, i) => {
    const cell = row.getCell(i + 1);
    cell.value = value ?? '';
    if (i === 10 && typeof value === 'number') cell.numFmt = '#,##0';
    paint(cell, base, INK, false);
    if (i >= 10 && i <= 11) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  });
}

function writeHq(wb: ExcelJS.Workbook, file: VisitFile, hq: VisitSheet, tab: string) {
  const ws = wb.addWorksheet(tab, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.pageSetup.printTitlesRow = '1:4';
  ws.columns = [...WHO, ...VISITS].map((col) => ({ width: col.width }));
  ws.mergeCells(1, 1, 1, LAST);
  const title = ws.getCell(1, 1);
  title.value = hq.name;
  title.font = { name: 'Calibri', size: 18, bold: true, color: { argb: NAVY } };
  title.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, LAST);
  const sub = ws.getCell(2, 1);
  sub.value = `${file.company}  ·  ${file.monthLabel}  ·  Doctor and chemist visits`;
  sub.font = { name: 'Calibri', size: 11, color: { argb: MUTED } };
  ws.getRow(2).height = 18;

  const band = ws.getRow(3);
  band.height = 18;
  ws.mergeCells(3, 1, 3, WHO.length);
  ws.mergeCells(3, WHO.length + 1, 3, LAST);
  band.getCell(1).value = 'Who';
  paint(band.getCell(1), NAVY, WHITE, true);
  for (let c = 2; c <= WHO.length; c++) paint(band.getCell(c), NAVY, WHITE, true);
  band.getCell(WHO.length + 1).value = 'Visits';
  paint(band.getCell(WHO.length + 1), DOCTOR_BAND, WHITE, true);
  for (let c = WHO.length + 2; c <= LAST; c++) paint(band.getCell(c), DOCTOR_BAND, WHITE, true);

  const head = ws.getRow(4);
  head.height = 32;
  [...WHO, ...VISITS].forEach((col, i) => {
    const cell = head.getCell(i + 1);
    cell.value = col.header;
    paint(cell, i < WHO.length ? SAND : DOCTOR, INK, true);
    cell.alignment = { vertical: 'bottom', horizontal: 'center', wrapText: true };
  });

  let r = 5;
  if (!hq.lines.length) {
    const row = ws.getRow(r);
    ws.mergeCells(r, 1, r, LAST);
    row.getCell(1).value = 'No doctor or chemist visits this month.';
    paint(row.getCell(1), WHITE, MUTED, false);
    for (let c = 2; c <= LAST; c++) paint(row.getCell(c), WHITE);
    r += 1;
  } else {
    let territory = '';
    for (const line of hq.lines) {
      if (line.territory !== territory) {
        territory = line.territory;
        const section = ws.getRow(r);
        section.height = 22;
        ws.mergeCells(r, 1, r, LAST);
        section.getCell(1).value = territory || 'Territory';
        paint(section.getCell(1), SAND, INK, true);
        for (let c = 2; c <= LAST; c++) paint(section.getCell(c), SAND, INK, true);
        r += 1;
      }
      writeLine(ws, r, line);
      r += 1;
    }
  }
  const total = ws.getRow(r);
  total.height = 22;
  const doctors = new Set(
    hq.lines.filter((line) => line.kind === 'doctor').map((line) => line.code),
  ).size;
  const chemists = new Set(
    hq.lines.filter((line) => line.kind === 'chemist').map((line) => line.code),
  ).size;
  const times = hq.lines.reduce((n, line) => n + line.times, 0);
  total.getCell(1).value = 'Headquarters total';
  paint(total.getCell(1), GOLD, INK, true);
  total.getCell(2).value = `${doctors} doctors · ${chemists} chemists`;
  paint(total.getCell(2), GOLD, INK, true);
  for (let c = 3; c <= LAST; c++) paint(total.getCell(c), GOLD, INK, true);
  total.getCell(11).value = times;
  total.getCell(11).numFmt = '#,##0';
  paint(total.getCell(11), GOLD, INK, true);
  total.getCell(11).alignment = { vertical: 'middle', horizontal: 'right' };
}

function writeCover(wb: ExcelJS.Workbook, file: VisitFile, tabs: Map<string, string>) {
  const ws = wb.addWorksheet('Cover', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 36 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }];
  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = 'Doc / chem visit breakdown';
  ws.getCell('A1').font = { name: 'Calibri', size: 22, bold: true, color: { argb: NAVY } };
  ws.getRow(1).height = 32;
  ws.getCell('A2').value = file.company;
  ws.getCell('A2').font = { name: 'Calibri', size: 14, color: { argb: INK } };
  ws.getCell('A3').value =
    `${file.monthLabel}  ·  Prepared for ${file.preparedFor}  ·  ${file.generatedAt}`;
  ws.getCell('A3').font = { name: 'Calibri', size: 11, color: { argb: MUTED } };
  ws.mergeCells('A5:E5');
  ws.getCell('A5').value =
    'Each headquarters is its own sheet. A row is one doctor or chemist seen by one person: how many times, and the dates.';
  ws.getCell('A5').alignment = { wrapText: true };
  ws.getCell('A5').font = { name: 'Calibri', size: 11, color: { argb: INK } };
  ws.getRow(5).height = 32;

  ['Headquarters', 'Doctors', 'Chemists', 'Visits', 'Open'].forEach((header, i) => {
    const cell = ws.getCell(7, i + 1);
    cell.value = header;
    paint(cell, NAVY, WHITE, true);
  });
  file.sheets.forEach((hq, i) => {
    const row = ws.getRow(8 + i);
    const tab = tabs.get(hq.name)!;
    const doctors = new Set(
      hq.lines.filter((line) => line.kind === 'doctor').map((line) => line.code),
    ).size;
    const chemists = new Set(
      hq.lines.filter((line) => line.kind === 'chemist').map((line) => line.code),
    ).size;
    const visits = hq.lines.reduce((n, line) => n + line.times, 0);
    [hq.name, doctors, chemists, visits].forEach((value, c) => {
      const cell = row.getCell(c + 1);
      cell.value = value;
      if (c > 0) cell.numFmt = '#,##0';
      paint(cell, i % 2 ? SAND : WHITE, INK, false);
    });
    const open = row.getCell(5);
    open.value = { text: 'Open', hyperlink: `#'${tab.replace(/'/g, "''")}'!A1` };
    paint(open, i % 2 ? SAND : WHITE, DOCTOR_BAND, false);
    open.font = { name: 'Calibri', size: 11, color: { argb: DOCTOR_BAND }, underline: true };
  });
  if (!file.sheets.length) {
    ws.getCell('A8').value = 'No headquarters in this team.';
    ws.getCell('A8').font = { name: 'Calibri', size: 11, color: { argb: MUTED } };
  }
}

function writeDefinitions(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Definitions', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 28 }, { width: 110 }];
  const rows: [string, string][] = [
    ['Row', 'One doctor or chemist, seen by one person in the month.'],
    ['Times', 'Every visit, including a second visit on the same day.'],
    ['Dates', 'The day of each visit, in order.'],
    ['Required', 'How often that doctor’s grade asks to be seen. Blank for a chemist.'],
    ['Visited by', 'The person whose report recorded the visit.'],
    ['Territory', 'The patch the doctor or chemist is filed under.'],
    [
      'Headquarters total',
      'Doctors and chemists on this sheet, counted once each, and every visit added up.',
    ],
  ];
  ws.getCell('A1').value = 'How to read this workbook';
  ws.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: NAVY } };
  rows.forEach((pair, i) => {
    const row = ws.getRow(i + 3);
    row.getCell(1).value = pair[0];
    row.getCell(2).value = pair[1];
    paint(row.getCell(1), SAND, INK, true);
    paint(row.getCell(2), WHITE, INK, false);
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
    row.height = 28;
  });
}

export async function visitXlsx(file: VisitFile): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AriForce';
  wb.title = `Doc / chem visit breakdown ${file.monthLabel}`;
  const used = new Set<string>(['cover', 'definitions']);
  const tabs = new Map<string, string>();
  for (const hq of file.sheets) tabs.set(hq.name, sheetTab(hq.name, used));
  writeCover(wb, file, tabs);
  for (const hq of file.sheets) writeHq(wb, file, hq, tabs.get(hq.name)!);
  writeDefinitions(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
