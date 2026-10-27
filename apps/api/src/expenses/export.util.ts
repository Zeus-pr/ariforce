import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ExpensesService } from './expenses.service';

type Data = Awaited<ReturnType<ExpensesService['reportData']>>;

/** Excel: "Claims" (one row per claim with reconciliation) and "Lines" (every line with day flags). */
export async function toXlsx(month: string, data: Data): Promise<Buffer> {
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
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF: summary table per claim plus a flagged-days list. Built-in Helvetica (ASCII names fine). */
export function toPdf(month: string, data: Data): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Expenses ${month}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(`Expense report ${month}`);
    const total = data.reduce((s, d) => s + d.rec.total, 0);
    doc
      .fontSize(10)
      .text(`Claims: ${data.length}   Total: INR ${total.toFixed(2)}`)
      .moveDown();
    const cols = [40, 210, 280, 360, 420, 480];
    const row = (vals: string[], bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      vals.forEach((v, i) =>
        doc.text(v, cols[i]!, y, { width: (cols[i + 1] ?? 555) - cols[i]! - 4 }),
      );
      doc.moveDown(0.3);
      if (doc.y > 780) doc.addPage();
    };
    row(['Employee', 'Status', 'Total', 'Claimed', 'DCR days', 'Unmatched'], true);
    for (const d of data)
      row([
        d.userName,
        d.status,
        d.rec.total.toFixed(2),
        String(d.rec.claimedDays),
        String(d.rec.dcrDays),
        d.rec.unmatchedAmount.toFixed(2),
      ]);
    const flagged = data.flatMap((d) =>
      d.rec.days.filter((x) => x.flags.length).map((x) => ({ d, x })),
    );
    if (flagged.length) {
      doc.moveDown().font('Helvetica-Bold').text('Flagged days', 40);
      for (const { d, x } of flagged)
        row([d.userName, x.date, x.claimed.toFixed(2), x.flags.join(', ')]);
    }
    doc.end();
  });
}
