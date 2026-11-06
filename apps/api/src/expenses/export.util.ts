import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ExpensesService } from './expenses.service';
import {
  buildStatementRows,
  statementTotals,
  type MoneyColumn,
  type StatementInput,
  type StatementRow,
} from './statement';

type Data = Awaited<ReturnType<ExpensesService['reportData']>>;
type Doc = InstanceType<typeof PDFDocument>;

/** Excel: "Claims" (one row per claim with reconciliation) and "Lines" (every line with day flags). */
export async function toXlsx(
  month: string,
  data: Data,
  statements: StatementInput[] = [],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AriForce';
  const s = wb.addWorksheet('Claims');
  s.columns = [
    { header: 'Employee', key: 'name', width: 28 },
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Total (INR)', key: 'total', width: 14 },
    { header: 'Travel', key: 'travel', width: 12 },
    { header: 'Hotel', key: 'hotel', width: 12 },
    { header: 'Food', key: 'food', width: 12 },
    { header: 'Mileage', key: 'mileage', width: 12 },
    { header: 'Allowance', key: 'allowance', width: 12 },
    { header: 'Other', key: 'other', width: 12 },
    { header: 'Claimed days', key: 'claimedDays', width: 13 },
    { header: 'DCR days', key: 'dcrDays', width: 10 },
    { header: 'Matched days', key: 'matchedDays', width: 13 },
    { header: 'Unmatched (INR)', key: 'unmatched', width: 16 },
  ];
  for (const d of data)
    s.addRow({
      name: d.userName,
      month,
      status: d.status,
      total: d.rec.total,
      ...d.rec.byCategory,
      claimedDays: d.rec.claimedDays,
      dcrDays: d.rec.dcrDays,
      matchedDays: d.rec.matchedDays,
      unmatched: d.rec.unmatchedAmount,
    });
  s.getRow(1).font = { bold: true };
  const l = wb.addWorksheet('Lines');
  l.columns = [
    { header: 'Employee', key: 'name', width: 28 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Category', key: 'category', width: 10 },
    { header: 'Amount (INR)', key: 'amount', width: 14 },
    { header: 'Km', key: 'km', width: 8 },
    { header: 'Notes', key: 'notes', width: 40 },
    { header: 'DCR status', key: 'dcr', width: 12 },
    { header: 'Flags', key: 'flags', width: 30 },
  ];
  for (const d of data)
    for (const x of d.lines) {
      const day = d.rec.days.find((y) => y.date === x.date);
      l.addRow({
        name: d.userName,
        date: x.date,
        category: x.category,
        amount: Number(x.amount),
        km: x.mileageKm === null ? null : Number(x.mileageKm),
        notes: x.notes ?? '',
        dcr: day?.dcrStatus ?? 'none',
        flags: day?.flags.join(', ') ?? '',
      });
    }
  l.getRow(1).font = { bold: true };
  const used = new Set<string>(['Claims', 'Lines']);
  for (const st of statements) addStatementSheet(wb, st, used);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const LOGO = join(__dirname, 'ariforce-logo.png');

/** Landscape day-by-day statement, one person per section. Same rows as the Excel statement sheet. */
export function toPdf(month: string, statements: StatementInput[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 22,
      bufferPages: true,
      info: { Title: `Expense Claim Report ${month}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (!statements.length) {
      doc.font('Helvetica-Bold').fontSize(14).text(`Expense Claim Report ${month}`, 22, 22);
      doc.font('Helvetica').fontSize(10).text('No claims for this month.', 22, 48);
    } else {
      statements.forEach((st, i) => {
        if (i) doc.addPage();
        drawStatement(doc, st);
      });
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#5c6b7a')
        .text(`${i + 1} / ${range.count}`, doc.page.width - 70, doc.page.height - 18, {
          width: 48,
          align: 'right',
          lineBreak: false,
        });
    }
    doc.end();
  });
}

const COLS: [string, number][] = [
  ['Date', 44],
  ['Activity', 48],
  ['DCR', 36],
  ['Category', 42],
  ['Work place', 52],
  ['From–to', 80],
  ['Km', 28],
  ['Doctors', 32],
  ['Accomp.', 34],
  ['Travel', 36],
  ['Daily', 32],
  ['Addl TA', 34],
  ['Courier', 32],
  ['Mobile', 30],
  ['Meeting', 34],
  ['Other', 32],
  ['Total', 34],
  ['Remarks', 76],
];

function drawStatement(doc: Doc, st: StatementInput) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const h = st.header;
  const rows = buildStatementRows(st);
  const totals = statementTotals(rows);
  let y = doc.page.margins.top;
  doc.fillColor('#102a43').font('Helvetica-Bold').fontSize(14);
  doc.text('Expense Claim Report', left, y, { lineBreak: false });
  if (existsSync(LOGO)) doc.image(LOGO, right - 78, y - 4, { height: 28 });
  y += 22;
  const [year, mon] = st.month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const period = `01-${pad(mon)}-${year} to ${last}-${pad(mon)}-${year}`;
  const facts: [string, string][] = [
    ['Employee', h.userName],
    ['Number', h.employeeCode ?? '-'],
    ['Designation', h.designation ?? '-'],
    ['HQ', h.hq ?? '-'],
    ['Region', h.region ?? '-'],
    ['Division', h.division ?? '-'],
    ['Joined', h.joinedOn ? dmy(h.joinedOn) : '-'],
    ['Manager', h.managerName ? `${h.managerName} (${h.managerCode ?? '-'})` : '-'],
    ['Period', period],
    ['Status', h.status],
    ['Mobile', h.phone ?? '-'],
    ['Email', h.email ?? '-'],
    ['Company', h.company || '-'],
    ['Total', totals.total.toFixed(2)],
  ];
  doc.fontSize(7.5);
  const colW = (right - left) / 2;
  for (let i = 0; i < facts.length; i += 2) {
    pair(doc, left, y, colW, facts[i]!);
    if (facts[i + 1]) pair(doc, left + colW, y, colW, facts[i + 1]!);
    y += 11;
  }
  y += 6;
  const head = () => {
    y = headerRow(doc, left, y);
  };
  head();
  const body = rows.map(rowCells);
  body.push([
    'Total',
    '',
    '',
    '',
    '',
    '',
    String(totals.distance),
    String(totals.doctorsMet),
    String(totals.accompanists),
    ...MONEY_HEADERS.map(([k]) => totals.money[k].toFixed(2)),
    totals.total.toFixed(2),
    '',
  ]);
  for (const [n, cells] of body.entries()) {
    const lastRow = n === body.length - 1;
    const height = rowHeight(doc, cells);
    if (y + height > doc.page.height - 28) {
      doc.addPage();
      y = doc.page.margins.top;
      head();
    }
    y = paintRow(doc, left, y, cells, height, lastRow);
  }
  y += 18;
  if (y > doc.page.height - 50) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  doc.strokeColor('#102a43').lineWidth(0.6);
  doc
    .moveTo(left, y)
    .lineTo(left + 160, y)
    .stroke();
  doc
    .moveTo(right - 160, y)
    .lineTo(right, y)
    .stroke();
  doc.fillColor('#102a43').font('Helvetica-Bold').fontSize(8);
  doc.text(h.employeeCode ?? h.userName, left, y + 4, { width: 160, lineBreak: false });
  doc.text(h.managerName ?? '', right - 160, y + 4, {
    width: 160,
    align: 'right',
    lineBreak: false,
  });
}

function pair(doc: Doc, x: number, y: number, width: number, [k, v]: [string, string]) {
  doc.font('Helvetica-Bold').fillColor('#5c6b7a').text(k, x, y, { width: 58, lineBreak: false });
  doc
    .font('Helvetica')
    .fillColor('#102a43')
    .text(v, x + 60, y, { width: width - 64, lineBreak: false, ellipsis: true });
}

function headerRow(doc: Doc, x: number, y: number) {
  const h = 16;
  let cursor = x;
  doc.font('Helvetica-Bold').fontSize(5.5);
  for (const [label, w] of COLS) {
    doc.save();
    doc.rect(cursor, y, w, h).fill('#e7eef5');
    doc.restore();
    doc.rect(cursor, y, w, h).lineWidth(0.3).strokeColor('#c5ced6').stroke();
    doc
      .fillColor('#102a43')
      .text(label, cursor + 1, y + 4, { width: w - 2, align: 'center', lineBreak: false });
    cursor += w;
  }
  return y + h;
}

function rowCells(r: StatementRow): string[] {
  return [
    dmy(r.date),
    r.activity,
    r.dcrStatus,
    r.category,
    r.workPlace,
    r.route,
    dash(r.distance),
    dash(r.doctorsMet),
    dash(r.accompanists),
    ...MONEY_HEADERS.map(([k]) => dash(r.money[k])),
    dash(r.total),
    r.remarks || '-',
  ];
}

function rowHeight(doc: Doc, cells: string[]) {
  doc.font('Helvetica').fontSize(6);
  let h = 11;
  cells.forEach((c, i) => {
    h = Math.max(h, doc.heightOfString(c || '-', { width: COLS[i]![1] - 3 }) + 3);
  });
  return Math.min(h, 32);
}

function paintRow(doc: Doc, x: number, y: number, cells: string[], height: number, bold: boolean) {
  let cursor = x;
  doc
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(6)
    .fillColor('#102a43');
  cells.forEach((c, i) => {
    const w = COLS[i]![1];
    doc.rect(cursor, y, w, height).lineWidth(0.3).strokeColor('#d5dee6').stroke();
    doc.text(c, cursor + 1.5, y + 1.5, { width: w - 3, height: height - 2 });
    cursor += w;
  });
  return y + height;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dmy = (d: string) => d.split('-').reverse().join('-');
const dash = (n: number) => (n ? String(n) : '-');

const MONEY_HEADERS: [MoneyColumn, string][] = [
  ['ta', 'Travel Allowance'],
  ['da', 'Daily Allowance'],
  ['additional', 'Additional TA DA'],
  ['courier', 'Courier'],
  ['mobile', 'Mobile'],
  ['teamMeeting', 'Team Meeting Expense'],
  ['other', 'Other Expense'],
];

function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Statement';
  let name = clean;
  for (let i = 2; used.has(name); i++) name = `${clean.slice(0, 26)} ${i}`;
  used.add(name);
  return name;
}

/** Expense Claim Report: header block, one row per day, totals row, signature footer. */
function addStatementSheet(wb: ExcelJS.Workbook, st: StatementInput, used: Set<string>) {
  const h = st.header;
  const rows = buildStatementRows(st);
  const t = statementTotals(rows);
  const s = wb.addWorksheet(sheetName(h.userName, used));
  const [y, m] = st.month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dmy = (d: string) => d.split('-').reverse().join('-');
  const pairs: [string, string][] = [
    ['Company Name', h.company],
    ['Employee Name', h.userName],
    ['Employee Number', h.employeeCode ?? '-'],
    ['Designation', h.designation ?? '-'],
    ['HQ', h.hq ?? '-'],
    ['Region Name', h.region ?? '-'],
    ['Division', h.division ?? '-'],
    ['Date of Joining', h.joinedOn ? dmy(h.joinedOn) : '-'],
    ['Manager Name', h.managerName ? `${h.managerName} (${h.managerCode ?? '-'})` : '-'],
    [
      'Period',
      `01-${String(m).padStart(2, '0')}-${y} to ${last}-${String(m).padStart(2, '0')}-${y}`,
    ],
    ['Status', h.status],
    ['Employee Mobile Number', h.phone ?? '-'],
    ['Email ID', h.email ?? '-'],
    ['Total Expense', String(t.total.toFixed(2))],
  ];
  s.addRow(['Expense Claim Report']).font = { bold: true, size: 14 };
  for (const [k, v] of pairs) {
    const r = s.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  s.addRow([]);
  const head = s.addRow([
    'Date',
    'Activity Name',
    'DCR Status',
    'Category',
    'Work Place',
    'From-To, Mode',
    'Distance',
    'Doctors Met',
    'Accompanist Count',
    ...MONEY_HEADERS.map(([, label]) => label),
    'Total Expense',
    'Remarks',
  ]);
  head.font = { bold: true };
  const widths = [12, 22, 12, 12, 24, 40, 10, 12, 12, 14, 14, 14, 10, 10, 14, 14, 14, 40];
  widths.forEach((w, i) => (s.getColumn(i + 1).width = w));
  const dash = (n: number) => (n ? n : '-');
  for (const r of rows)
    s.addRow([
      dmy(r.date),
      r.activity,
      r.dcrStatus,
      r.category,
      r.workPlace,
      r.route,
      dash(r.distance),
      dash(r.doctorsMet),
      dash(r.accompanists),
      ...MONEY_HEADERS.map(([k]) => dash(r.money[k])),
      dash(r.total),
      r.remarks || '-',
    ]);
  const tot = s.addRow([
    'Total',
    '',
    '',
    '',
    '',
    '',
    t.distance,
    t.doctorsMet,
    t.accompanists,
    ...MONEY_HEADERS.map(([k]) => t.money[k]),
    t.total,
    '',
  ]);
  tot.font = { bold: true };
  s.addRow([]);
  s.addRow([
    `Employee: ${h.employeeCode ?? h.userName}`,
    '',
    '',
    '',
    '',
    `Manager: ${h.managerName ?? ''}`,
  ]).font = { bold: true };
}
