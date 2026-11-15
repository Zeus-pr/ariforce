import PDFDocument from 'pdfkit';

type Row = {
  name: string;
  pack: string | null;
  openingQty: number | null;
  openingValue: number | null;
  purchaseQty: number;
  purchaseValue: number | null;
  secondaryQty: number;
  secondaryValue: number | null;
  closingQty: number | null;
  closingValue: number | null;
  frsQty: number;
};

const n = (v: number | null) => (v == null ? '' : v.toFixed(2));
const q = (v: number | null) => (v == null ? '' : String(v));

/** Stock & sales analysis in the sample layout. Values are the stored paise amounts. */
export function statementPdf(input: {
  company: string;
  stockist: string;
  address: string;
  month: string;
  lines: Row[];
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const [y, m] = input.month.slice(0, 7).split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const period = `01-${pad(m)}-${y} - ${pad(last)}-${pad(m)}-${y}`;
  let page = 1;
  let cursor = header(doc, input, period, page);
  const cols = [28, 220, 270, 310, 370, 410, 470, 510, 570, 610, 670, 720];
  const run = emptyRun();
  const add = (row: Row) => {
    run.oq += row.openingQty ?? 0;
    run.ov += row.openingValue ?? 0;
    run.pq += row.purchaseQty;
    run.pv += row.purchaseValue ?? 0;
    run.sq += row.secondaryQty;
    run.sv += row.secondaryValue ?? 0;
    run.cq += row.closingQty ?? 0;
    run.cv += row.closingValue ?? 0;
    run.fq += row.frsQty;
  };
  for (const row of input.lines) {
    if (cursor > 520) {
      total(doc, cursor, cols, run, false);
      doc.addPage();
      page += 1;
      cursor = header(doc, input, period, page);
    }
    doc.fontSize(7).text(row.name, cols[0], cursor, { width: 180, lineBreak: false });
    doc.text(row.pack ?? '', cols[1], cursor, { width: 48, lineBreak: false });
    doc.text(q(row.openingQty), cols[2], cursor, { width: 36, align: 'right', lineBreak: false });
    doc.text(n(row.openingValue), cols[3], cursor, { width: 52, align: 'right', lineBreak: false });
    doc.text(q(row.purchaseQty), cols[4], cursor, { width: 36, align: 'right', lineBreak: false });
    doc.text(n(row.purchaseValue), cols[5], cursor, {
      width: 52,
      align: 'right',
      lineBreak: false,
    });
    doc.text(q(row.secondaryQty), cols[6], cursor, { width: 36, align: 'right', lineBreak: false });
    doc.text(n(row.secondaryValue), cols[7], cursor, {
      width: 52,
      align: 'right',
      lineBreak: false,
    });
    doc.text(q(row.closingQty), cols[8], cursor, { width: 36, align: 'right', lineBreak: false });
    doc.text(n(row.closingValue), cols[9], cursor, { width: 52, align: 'right', lineBreak: false });
    doc.text(q(row.frsQty), cols[10], cursor, { width: 36, align: 'right', lineBreak: false });
    add(row);
    cursor += 12;
  }
  total(doc, cursor + 4, cols, run, true);
  doc.end();
  return done;
}

function header(
  doc: InstanceType<typeof PDFDocument>,
  input: { company: string; stockist: string; address: string },
  period: string,
  page: number,
) {
  doc.fontSize(11).text(input.stockist, 28, 28, { lineBreak: false });
  doc.fontSize(8).text(input.address, 28, 44, { lineBreak: false });
  doc.fontSize(10).text(`STOCK & SALES ANALYSIS (${input.company})`, 280, 28, { lineBreak: false });
  doc.fontSize(8).text(period, 620, 28, { lineBreak: false });
  doc.text(`Page ${page}`, 760, 44, { lineBreak: false });
  const y = 68;
  doc.fontSize(7);
  doc.text('ITEM DESCRIPTION', 28, y);
  doc.text('OPENING', 310, y);
  doc.text('RECEIPT', 430, y);
  doc.text('ISSUE', 530, y);
  doc.text('CLOSING', 630, y);
  doc.text('DUMP', 730, y);
  doc.text('QTY    VALUE', 300, y + 12);
  doc.text('QTY    VALUE', 400, y + 12);
  doc.text('QTY    VALUE', 500, y + 12);
  doc.text('QTY    VALUE', 600, y + 12);
  doc.text('QTY', 730, y + 12);
  doc
    .moveTo(28, y + 24)
    .lineTo(800, y + 24)
    .stroke();
  return y + 30;
}

function total(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  cols: number[],
  run: ReturnType<typeof emptyRun>,
  last: boolean,
) {
  doc.fontSize(8).text(last ? 'TOTAL' : 'Continued', cols[0]!, y);
  const cells = [run.oq, run.ov, run.pq, run.pv, run.sq, run.sv, run.cq, run.cv, run.fq];
  cells.forEach((v, i) => {
    doc.text(typeof v === 'number' && i % 2 === 1 ? v.toFixed(2) : String(v), cols[i + 2]!, y, {
      width: i % 2 === 1 ? 52 : 36,
      align: 'right',
      lineBreak: false,
    });
  });
}

function emptyRun() {
  return { oq: 0, ov: 0, pq: 0, pv: 0, sq: 0, sv: 0, cq: 0, cv: 0, fq: 0 };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
