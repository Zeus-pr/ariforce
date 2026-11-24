import PDFDocument from 'pdfkit';

export type SlipPdf = {
  company: string;
  name: string;
  month: string;
  totalDays: number;
  paidDays: number;
  unpaidDays: number;
  absentDays: number;
  lopDays: number;
  basic: number;
  hra: number;
  special: number;
  gross: number;
  professionalTax: number;
  esi: number;
  bonusDeduction: number;
  deductions: number;
  net: number;
};

const inr = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function payslipPdf(s: SlipPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Payslip ${s.month}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(16).text(s.company);
    doc.font('Helvetica').fontSize(11).moveDown(0.3).text(`Pay slip · ${s.month}`);
    doc.moveDown(0.4).text(s.name);
    doc
      .moveDown(0.6)
      .text(
        `Total days ${s.totalDays}    Paid ${s.paidDays}    Unpaid ${s.unpaidDays}    Absent ${s.absentDays}    Loss of pay ${s.lopDays}`,
      );
    doc.moveDown();
    const line = (label: string, amount: number, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 48, doc.y, { continued: true });
      doc.text(inr(amount), { align: 'right' });
    };
    line('Basic', s.basic);
    line('HRA', s.hra);
    line('Special allowance', s.special);
    line('Gross', s.gross, true);
    doc.moveDown(0.4);
    line('Professional tax', s.professionalTax);
    line('ESI', s.esi);
    line('Deduction for annual bonus', s.bonusDeduction);
    line('Deductions', s.deductions, true);
    doc.moveDown(0.4);
    line('Net salary', s.net, true);
    doc.end();
  });
}
