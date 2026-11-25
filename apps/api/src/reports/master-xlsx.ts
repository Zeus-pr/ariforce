import ExcelJS from 'exceljs';
import {
  sheetTab,
  type Figures,
  type HqSheet,
  type MasterFile,
  type PersonLine,
} from './master-layout';

const NAVY = 'FF1B3A4B';
const SAND = 'FFF4EFE6';
const GOLD = 'FFF3E6C8';
const INK = 'FF1B3A4B';
const MUTED = 'FF5C6B73';
const WHITE = 'FFFFFFFF';
const LINE = 'FFD9D3C7';
const GREEN = 'FFE5F2E9';
const AMBER = 'FFF8EBD4';
const ROSE = 'FFF8E4E4';
const BLUE = 'FFE6F0F8';

type Kind = 'day' | 'count' | 'avg' | 'pct' | 'inr';

const COLS: { header: string; key: keyof Figures; width: number; kind: Kind; band: string }[] = [
  { header: 'Working days', key: 'workingDays', width: 14, kind: 'day', band: 'Days' },
  { header: 'Present', key: 'present', width: 12, kind: 'day', band: 'Days' },
  { header: 'Absent', key: 'absent', width: 12, kind: 'day', band: 'Days' },
  { header: 'Holiday', key: 'holiday', width: 12, kind: 'day', band: 'Days' },
  { header: 'Casual leave (CL)', key: 'cl', width: 18, kind: 'day', band: 'Leave' },
  { header: 'Sick leave (SL)', key: 'sl', width: 16, kind: 'day', band: 'Leave' },
  { header: 'Privilege leave (EL)', key: 'el', width: 20, kind: 'day', band: 'Leave' },
  { header: 'Loss of pay (LOP)', key: 'lop', width: 18, kind: 'day', band: 'Leave' },
  { header: 'Other leave', key: 'otherLeave', width: 14, kind: 'day', band: 'Leave' },
  { header: 'Field days', key: 'fieldDays', width: 13, kind: 'day', band: 'Work' },
  { header: 'Camp days', key: 'campDays', width: 13, kind: 'day', band: 'Work' },
  { header: 'Meeting days', key: 'meetingDays', width: 15, kind: 'day', band: 'Work' },
  { header: 'Training days', key: 'trainingDays', width: 15, kind: 'day', band: 'Work' },
  { header: 'Other days', key: 'otherDays', width: 13, kind: 'day', band: 'Work' },
  { header: 'Unique doctors', key: 'uniqueDoctors', width: 16, kind: 'count', band: 'Doctors' },
  { header: 'Doctor visits', key: 'doctorVisits', width: 15, kind: 'count', band: 'Doctors' },
  { header: 'Call average', key: 'callAverage', width: 14, kind: 'avg', band: 'Doctors' },
  { header: 'Coverage', key: 'coverage', width: 12, kind: 'pct', band: 'Doctors' },
  { header: 'Frequency', key: 'frequency', width: 12, kind: 'pct', band: 'Doctors' },
  { header: 'Missed doctors', key: 'missed', width: 16, kind: 'pct', band: 'Doctors' },
  { header: 'Unique chemists', key: 'uniqueChemists', width: 16, kind: 'count', band: 'Chemists' },
  { header: 'Chemist visits', key: 'chemistVisits', width: 15, kind: 'count', band: 'Chemists' },
  {
    header: 'Chemist call average',
    key: 'chemistAverage',
    width: 20,
    kind: 'avg',
    band: 'Chemists',
  },
  { header: 'MSL size', key: 'msl', width: 12, kind: 'count', band: 'Targets' },
  { header: 'Primary target', key: 'primaryTarget', width: 16, kind: 'inr', band: 'Targets' },
  { header: 'Primary sales', key: 'primarySales', width: 16, kind: 'inr', band: 'Targets' },
  {
    header: 'Primary achievement',
    key: 'primaryAchievement',
    width: 20,
    kind: 'pct',
    band: 'Targets',
  },
  { header: 'Secondary target', key: 'secondaryTarget', width: 18, kind: 'inr', band: 'Targets' },
  { header: 'Secondary sales', key: 'secondarySales', width: 16, kind: 'inr', band: 'Targets' },
  {
    header: 'Secondary achievement',
    key: 'secondaryAchievement',
    width: 22,
    kind: 'pct',
    band: 'Targets',
  },
  { header: 'POB value', key: 'pob', width: 14, kind: 'inr', band: 'Targets' },
  { header: 'Growth vs last year', key: 'growth', width: 20, kind: 'pct', band: 'Targets' },
  { header: 'DCR compliance', key: 'dcrCompliance', width: 16, kind: 'pct', band: 'Discipline' },
  { header: 'DCR on time', key: 'dcrOnTime', width: 14, kind: 'pct', band: 'Discipline' },
  { header: 'Tour plan adherence', key: 'tpAdherence', width: 20, kind: 'pct', band: 'Discipline' },
];

const WHO = [
  { header: 'Name', width: 24 },
  { header: 'Employee code', width: 16 },
  { header: 'Role', width: 24 },
  { header: 'Manager', width: 22 },
];

const BAND_HEAD: Record<string, string> = {
  Who: 'FFE7EEF2',
  Days: SAND,
  Leave: AMBER,
  Work: GREEN,
  Doctors: BLUE,
  Chemists: 'FFE5F4F2',
  Targets: GOLD,
  Discipline: 'FFE8EEF2',
};

const BAND_FILL: Record<string, string> = {
  Who: NAVY,
  Days: 'FF8A7355',
  Leave: 'FF8C6239',
  Work: 'FF2F6F4E',
  Doctors: 'FF1F4E79',
  Chemists: 'FF1F6F6A',
  Targets: 'FF8A6A2F',
  Discipline: 'FF3E5160',
};

const NUM: Record<Kind, string> = {
  day: '0.0',
  count: '#,##0',
  avg: '0.00',
  pct: '0.0"%"',
  inr: '₹#,##0',
};

const LAST = WHO.length + COLS.length;

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

function achievementFill(v: number | null) {
  if (v == null) return null;
  if (v >= 100) return GREEN;
  if (v >= 80) return AMBER;
  return ROSE;
}

function writeFigures(row: ExcelJS.Row, figures: Figures, base: string, bold: boolean) {
  COLS.forEach((col, i) => {
    const cell = row.getCell(WHO.length + 1 + i);
    const v = figures[col.key];
    cell.value = v == null ? null : v;
    if (v != null) cell.numFmt = NUM[col.kind];
    const growthTone = col.key === 'growth' && v != null ? (v < 0 ? ROSE : GREEN) : null;
    const tone =
      (col.key === 'primaryAchievement' || col.key === 'secondaryAchievement'
        ? achievementFill(v)
        : growthTone) ??
      ((col.key === 'absent' || col.key === 'lop') && v != null && v > 0 ? ROSE : base);
    paint(cell, tone, INK, bold);
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
  });
}

function sectionRow(ws: ExcelJS.Worksheet, rowNo: number, label: string, tone: string) {
  const row = ws.getRow(rowNo);
  row.height = 22;
  ws.mergeCells(rowNo, 1, rowNo, LAST);
  const cell = row.getCell(1);
  cell.value = label;
  paint(cell, tone, INK, true);
  for (let c = 2; c <= LAST; c++) paint(row.getCell(c), tone, INK, true);
  return rowNo + 1;
}

function personRow(ws: ExcelJS.Worksheet, rowNo: number, person: PersonLine, base: string) {
  const row = ws.getRow(rowNo);
  row.height = 18;
  const who = [person.name, person.code, person.role, person.manager];
  who.forEach((v, i) => {
    const cell = row.getCell(i + 1);
    cell.value = v;
    paint(cell, base, INK, false);
  });
  writeFigures(row, person.figures, base, false);
  return rowNo + 1;
}

function totalRow(ws: ExcelJS.Worksheet, rowNo: number, figures: Figures) {
  const row = ws.getRow(rowNo);
  row.height = 22;
  const cell = row.getCell(1);
  cell.value = 'Headquarters total';
  paint(cell, GOLD, INK, true);
  for (let c = 2; c <= WHO.length; c++) paint(row.getCell(c), GOLD, INK, true);
  writeFigures(row, figures, GOLD, true);
}

function writeHq(wb: ExcelJS.Workbook, file: MasterFile, hq: HqSheet, tab: string) {
  const ws = wb.addWorksheet(tab, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  ws.pageSetup.printTitlesRow = '1:4';
  ws.columns = [...WHO, ...COLS].map((c) => ({ width: c.width }));
  ws.mergeCells(1, 1, 1, LAST);
  const title = ws.getCell(1, 1);
  title.value = hq.name;
  title.font = { name: 'Calibri', size: 18, bold: true, color: { argb: NAVY } };
  title.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, LAST);
  const sub = ws.getCell(2, 1);
  sub.value = `${file.company}  ·  ${file.monthLabel}  ·  People posted here, then each territory`;
  sub.font = { name: 'Calibri', size: 11, color: { argb: MUTED } };
  ws.getRow(2).height = 18;

  const bandRow = ws.getRow(3);
  bandRow.height = 18;
  const headers = [...WHO.map((c) => ({ ...c, band: 'Who' })), ...COLS];
  let start = 1;
  for (let i = 0; i < headers.length;) {
    const band = headers[i]!.band;
    let j = i;
    while (j < headers.length && headers[j]!.band === band) j += 1;
    if (j - 1 > i) ws.mergeCells(3, start, 3, start + (j - i) - 1);
    const cell = bandRow.getCell(start);
    cell.value = band;
    paint(cell, BAND_FILL[band] ?? NAVY, WHITE, true);
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    for (let c = start + 1; c < start + (j - i); c++)
      paint(bandRow.getCell(c), BAND_FILL[band] ?? NAVY, WHITE, true);
    start += j - i;
    i = j;
  }

  const head = ws.getRow(4);
  head.height = 32;
  headers.forEach((col, i) => {
    const cell = head.getCell(i + 1);
    cell.value = col.header;
    paint(cell, BAND_HEAD[col.band] ?? SAND, INK, true);
    cell.alignment = { vertical: 'bottom', horizontal: 'center', wrapText: true };
  });

  let r = 5;
  r = sectionRow(ws, r, 'People', SAND);
  if (!hq.people.length) {
    const row = ws.getRow(r);
    row.getCell(1).value = 'Vacant';
    paint(row.getCell(1), WHITE, MUTED, false);
    for (let c = 2; c <= LAST; c++) paint(row.getCell(c), WHITE);
    r += 1;
  } else {
    hq.people.forEach((person, i) => {
      r = personRow(ws, r, person, i % 2 ? 'FFFBF9F6' : WHITE);
    });
  }
  for (const patch of hq.patches) {
    r = sectionRow(ws, r, patch.name, BLUE);
    const row = ws.getRow(r);
    row.height = 18;
    row.getCell(1).value = patch.name;
    paint(row.getCell(1), WHITE, INK, false);
    row.getCell(3).value = 'Territory';
    paint(row.getCell(3), WHITE, MUTED, false);
    for (const c of [2, 4]) paint(row.getCell(c), WHITE);
    writeFigures(row, patch.figures, WHITE, false);
    r += 1;
  }
  totalRow(ws, r, hq.total);
}

function writeCover(wb: ExcelJS.Workbook, file: MasterFile, tabs: Map<string, string>) {
  const ws = wb.addWorksheet('Cover', { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 36 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 22 },
    { width: 14 },
  ];
  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = 'Master Excel';
  ws.getCell('A1').font = { name: 'Calibri', size: 22, bold: true, color: { argb: NAVY } };
  ws.getRow(1).height = 32;
  ws.getCell('A2').value = file.company;
  ws.getCell('A2').font = { name: 'Calibri', size: 14, color: { argb: INK } };
  ws.getCell('A3').value =
    `${file.monthLabel}  ·  Prepared for ${file.preparedFor}  ·  ${file.generatedAt}`;
  ws.getCell('A3').font = { name: 'Calibri', size: 11, color: { argb: MUTED } };
  ws.mergeCells('A5:G5');
  ws.getCell('A5').value =
    'Each headquarters is its own sheet. The people at the top are posted to that headquarters. Each territory under them is a patch: doctors, visits and sales for that patch. Leave and attendance stay on the person.';
  ws.getCell('A5').alignment = { wrapText: true };
  ws.getCell('A5').font = { name: 'Calibri', size: 11, color: { argb: INK } };
  ws.getRow(5).height = 36;

  const heads = [
    'Headquarters',
    'People',
    'Present',
    'Absent',
    'Doctor visits',
    'Primary achievement',
    'Open',
  ];
  heads.forEach((h, i) => {
    const cell = ws.getCell(7, i + 1);
    cell.value = h;
    paint(cell, NAVY, WHITE, true);
  });
  file.sheets.forEach((hq, i) => {
    const row = ws.getRow(8 + i);
    const tab = tabs.get(hq.name)!;
    const present = hq.people.reduce((n, p) => n + (p.figures.present ?? 0), 0);
    const absent = hq.people.reduce((n, p) => n + (p.figures.absent ?? 0), 0);
    const visits = hq.people.reduce((n, p) => n + (p.figures.doctorVisits ?? 0), 0);
    const values: (string | number | null)[] = [
      hq.name,
      hq.people.length,
      present,
      absent,
      visits,
      hq.total.primaryAchievement,
    ];
    values.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v;
      if (c >= 2 && c <= 4 && typeof v === 'number') cell.numFmt = '#,##0';
      if (c === 5 && v != null) cell.numFmt = '0.0"%"';
      paint(cell, i % 2 ? SAND : WHITE, INK, false);
    });
    const open = row.getCell(7);
    open.value = { text: 'Open', hyperlink: `#'${tab.replace(/'/g, "''")}'!A1` };
    open.font = { name: 'Calibri', size: 11, color: { argb: 'FF1F4E79' }, underline: true };
    paint(open, i % 2 ? SAND : WHITE, 'FF1F4E79', false);
    open.font = { name: 'Calibri', size: 11, color: { argb: 'FF1F4E79' }, underline: true };
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
    ['People', 'Posted to this headquarters. A suspended or empty seat is Vacant.'],
    [
      'Territory',
      'A patch under the headquarters. Its row is the outlets tagged to that patch, not a second person.',
    ],
    ['Present', 'Working days with a punch-in. Sundays are not working days.'],
    [
      'Absent',
      'A working day with no punch-in and no leave. A half-day leave without a punch counts as half absent.',
    ],
    ['Privilege leave (EL)', 'Earned leave. The leave type in AriForce is EL.'],
    [
      'Doctor visits',
      'Every doctor call in the month, including a second and third visit to the same doctor.',
    ],
    ['Unique doctors', 'Each doctor counted once, whether or not they are on the must-see list.'],
    ['Coverage', 'Must-see doctors met at least once, divided by the must-see list.'],
    [
      'Frequency',
      'Must-see doctors seen as often as their grade requires, divided by the must-see list.',
    ],
    ['Chemist visits', 'Every chemist call, including repeat visits.'],
    ['Unique chemists', 'Each chemist counted once.'],
    ['Call average', 'Doctor visits divided by field days.'],
    ['Field days', 'Days of field work. A day shared with other work counts as half.'],
    [
      'Primary achievement',
      'Primary sales divided by the primary target. Green is 100 or more, amber from 80, red below.',
    ],
    [
      'Headquarters total',
      'People added together. Sales are the headquarters target counted once, not added again from each person.',
    ],
    ['Territory sales', 'The target and sales booked on that patch, counted once.'],
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
    row.height = 32;
  });
}

export async function masterXlsx(file: MasterFile): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AriForce';
  wb.title = `Master Excel ${file.monthLabel}`;
  const used = new Set<string>(['cover', 'definitions']);
  const tabs = new Map<string, string>();
  for (const hq of file.sheets) tabs.set(hq.name, sheetTab(hq.name, used));
  writeCover(wb, file, tabs);
  for (const hq of file.sheets) writeHq(wb, file, hq, tabs.get(hq.name)!);
  writeDefinitions(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
