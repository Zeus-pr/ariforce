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

type Box = { x: number; w: number };

const left = 18;
const item: Box = { x: left, w: 206 };
const pack: Box = { x: 224, w: 46 };
const qtyW = 42;
const valW = 84;
const pair = qtyW + valW;
const groupX = 270;
const groups = ['OPENING', 'RECEIPT', 'ISSUE', 'CLOSING'].map((name, i) => {
  const x = groupX + i * pair;
  return { name, qty: { x, w: qtyW }, value: { x: x + qtyW, w: valW } };
});
const dump: Box = { x: groupX + groups.length * pair, w: 44 };
const right = dump.x + dump.w;

const n = (v: number | null) => (v == null ? '' : v.toFixed(2));
const q = (v: number | null) => (v == null ? '' : String(v));

/** Stock & sales analysis. Every figure is placed on the right edge of its own column. */
export function statementPdf(input: {
  company: string;
  stockist: string;
  address: string;
  month: string;
  lines: Row[];
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 18 });
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
  let ruleTop = cursor - 6;
  const run = emptyRun();
  for (const row of input.lines) {
    if (cursor > 540) {
      rules(doc, ruleTop, cursor);
      total(doc, cursor, run, false);
      doc.addPage();
      page += 1;
      cursor = header(doc, input, period, page);
      ruleTop = cursor - 6;
    }
    doc.fontSize(7);
    at(doc, row.name, item, cursor, 'left');
    at(doc, row.pack ?? '', pack, cursor, 'left');
    const cells = [
      q(row.openingQty),
      n(row.openingValue),
      q(row.purchaseQty),
      n(row.purchaseValue),
      q(row.secondaryQty),
      n(row.secondaryValue),
      q(row.closingQty),
      n(row.closingValue),
      q(row.frsQty),
    ];
    figureBoxes().forEach((box, i) => at(doc, cells[i] ?? '', box, cursor, 'right'));
    run.oq += row.openingQty ?? 0;
    run.ov += row.openingValue ?? 0;
    run.pq += row.purchaseQty;
    run.pv += row.purchaseValue ?? 0;
    run.sq += row.secondaryQty;
    run.sv += row.secondaryValue ?? 0;
    run.cq += row.closingQty ?? 0;
    run.cv += row.closingValue ?? 0;
    run.fq += row.frsQty;
    cursor += 11;
  }
  rules(doc, ruleTop, cursor);
  total(doc, cursor + 2, run, true);
  doc.end();
  return done;
}

function header(
  doc: InstanceType<typeof PDFDocument>,
  input: { company: string; stockist: string; address: string },
  period: string,
  page: number,
) {
  doc.fontSize(11);
  at(doc, input.stockist, { x: left, w: 300 }, 20, 'left');
  doc.fontSize(10);
  at(doc, `STOCK & SALES ANALYSIS (${input.company})`, { x: 300, w: 280 }, 20, 'center');
  doc.fontSize(8);
  at(doc, period, { x: 620, w: 198 }, 20, 'right');
  const addressH = input.address ? doc.heightOfString(input.address, { width: 500 }) : 0;
  if (input.address) doc.text(input.address, left, 36, { width: 500 });
  at(doc, `Page ${page}`, { x: 740, w: 78 }, 36, 'right');
  const y = 44 + Math.max(addressH, 12);
  doc.fontSize(7);
  at(doc, 'ITEM DESCRIPTION', item, y, 'left');
  for (const group of groups) {
    at(doc, group.name, { x: group.qty.x, w: pair }, y, 'center');
    at(doc, 'QTY', group.qty, y + 11, 'right');
    at(doc, 'VALUE', group.value, y + 11, 'right');
  }
  at(doc, 'DUMP', dump, y, 'right');
  at(doc, 'QTY', dump, y + 11, 'right');
  doc
    .moveTo(left, y + 23)
    .lineTo(right, y + 23)
    .stroke();
  return y + 29;
}

function rules(doc: InstanceType<typeof PDFDocument>, top: number, bottom: number) {
  const xs = [left, pack.x, ...groups.flatMap((g) => [g.qty.x, g.value.x]), dump.x, right];
  doc.save().strokeColor('#bbbbbb').lineWidth(0.4);
  for (const x of xs) {
    doc.moveTo(x, top).lineTo(x, bottom).stroke();
  }
  doc.restore();
}

function total(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  run: ReturnType<typeof emptyRun>,
  last: boolean,
) {
  doc.fontSize(8);
  at(doc, last ? 'TOTAL' : 'Continued', item, y, 'left');
  const cells = [
    String(run.oq),
    run.ov.toFixed(2),
    String(run.pq),
    run.pv.toFixed(2),
    String(run.sq),
    run.sv.toFixed(2),
    String(run.cq),
    run.cv.toFixed(2),
    String(run.fq),
  ];
  figureBoxes().forEach((box, i) => at(doc, cells[i] ?? '', box, y, 'right'));
}

function figureBoxes() {
  return groups.flatMap((group) => [group.qty, group.value]).concat(dump);
}

function at(
  doc: InstanceType<typeof PDFDocument>,
  value: string,
  box: Box,
  y: number,
  align: 'left' | 'right' | 'center',
) {
  const width = doc.widthOfString(value);
  const x =
    align === 'right'
      ? box.x + box.w - width
      : align === 'center'
        ? box.x + (box.w - width) / 2
        : box.x;
  doc.text(value, x, y, { lineBreak: false });
}

function emptyRun() {
  return { oq: 0, ov: 0, pq: 0, pv: 0, sq: 0, sv: 0, cq: 0, cv: 0, fq: 0 };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
