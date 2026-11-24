import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';

const LOGO = join(__dirname, '../expenses/ariforce-logo.png');

export type SlipPdf = {
  company: string;
  name: string;
  month: string;
  employeeCode: string | null;
  joinedOn: string | null;
  department: string | null;
  designation: string | null;
  branch: string | null;
  pfAccount: string | null;
  esiNumber: string | null;
  totalDays: number;
  paidDays: number;
  unpaidDays: number;
  basic: number;
  hra: number;
  special: number;
  fixedBasic: number;
  fixedHra: number;
  fixedSpecial: number;
  gross: number;
  expenseLabel: string;
  expenseAmount: number;
  earnings: number;
  professionalTax: number;
  esi: number;
  bonusDeduction: number;
  deductions: number;
  net: number;
};

const money = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BELOW_20 = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function wordsUnder100(n: number): string {
  if (n < 20) return BELOW_20[n] ?? '';
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one ? `${TENS[ten]} ${BELOW_20[one]}` : (TENS[ten] ?? '');
}

function wordsUnder1000(n: number): string {
  if (n < 100) return wordsUnder100(n);
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return rest
    ? `${BELOW_20[hundred]} Hundred ${wordsUnder100(rest)}`
    : `${BELOW_20[hundred]} Hundred`;
}

/** Indian grouping: crore, lakh, thousand. */
export function rupeesInWords(n: number): string {
  const value = Math.max(0, Math.round(n));
  if (value === 0) return 'Zero Rupees';
  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const rest = value % 1000;
  const parts = [
    crore ? `${wordsUnder100(crore)} Crore` : '',
    lakh ? `${wordsUnder100(lakh)} Lakh` : '',
    thousand ? `${wordsUnder1000(thousand)} Thousand` : '',
    rest ? wordsUnder1000(rest) : '',
  ].filter(Boolean);
  return `${parts.join(' ')} Rupees`;
}

function dateLabel(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export function payslipPdf(s: SlipPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Payslip ${s.month}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 36;
    const right = 559;
    const width = right - left;
    let y = 32;
    if (existsSync(LOGO)) doc.image(LOGO, left, y, { height: 36 });
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#111827')
      .text(s.company, left + 48, y + 4, {
        width: width - 48,
      });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#374151')
      .text(`Pay Slip for the period of ${s.month}`, left + 48, y + 24, { width: width - 48 });
    y += 52;

    const facts: [string, string][] = [
      ['NAME', s.name],
      ['EMPLOYEE ID', s.employeeCode || '—'],
      ['DOJ', dateLabel(s.joinedOn)],
      ['DEPARTMENT', s.department || '—'],
      ['DESIGNATION', s.designation || '—'],
      ['WORK LOCATION', s.branch || '—'],
      ['PF NUMBER', s.pfAccount || '—'],
      ['ESI NUMBER', s.esiNumber || '—'],
      ['TOTAL DAYS', money(s.totalDays)],
      ['PAID DAYS', money(s.paidDays)],
      ['UNPAID DAYS', money(s.unpaidDays)],
    ];
    doc.fontSize(8);
    const colW = width / 2;
    facts.forEach(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = left + col * colW;
      const lineY = y + row * 14;
      doc
        .font('Helvetica-Bold')
        .fillColor('#111827')
        .text(`${label} : `, x, lineY, { continued: true, width: colW - 8 });
      doc.font('Helvetica').text(value, { width: colW - 8 });
    });
    y += Math.ceil(facts.length / 2) * 14 + 12;

    const mid = left + width * 0.58;
    doc.rect(left, y, width, 18).fill('#111827');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
    doc.text('EARNINGS', left + 8, y + 5, { width: mid - left - 16 });
    doc.text('DEDUCTIONS', mid + 8, y + 5);
    y += 18;
    doc.rect(left, y, mid - left, 16).fill('#f3f4f6');
    doc.rect(mid, y, right - mid, 16).fill('#f3f4f6');
    doc.fillColor('#374151').fontSize(8);
    doc.text('ITEMS', left + 8, y + 4, { width: 140 });
    doc.text('FIXED', left + 160, y + 4, { width: 70, align: 'right' });
    doc.text('AMOUNT', mid - 78, y + 4, { width: 70, align: 'right' });
    doc.text('ITEMS', mid + 8, y + 4);
    doc.text('AMOUNT', right - 78, y + 4, { width: 70, align: 'right' });
    y += 16;

    const earnings: [string, number, number][] = [
      ['Basic', s.fixedBasic, s.basic],
      ['HRA', s.fixedHra, s.hra],
      ['Special Allowance', s.fixedSpecial, s.special],
      [s.expenseLabel, 0, s.expenseAmount],
    ];
    const deductions: [string, number][] = [
      ['Professional tax', s.professionalTax],
      ['ESI', s.esi],
      ['Deduction for annual bonus', s.bonusDeduction],
    ];
    const rows = Math.max(earnings.length, deductions.length);
    for (let i = 0; i < rows; i++) {
      const band = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(left, y, width, 16).fill(band);
      doc.fillColor('#111827').font('Helvetica').fontSize(8);
      const earn = earnings[i];
      if (earn) {
        doc.text(earn[0], left + 8, y + 4, { width: 140 });
        doc.text(money(earn[1]), left + 160, y + 4, { width: 70, align: 'right' });
        doc.text(money(earn[2]), mid - 78, y + 4, { width: 70, align: 'right' });
      }
      const cut = deductions[i];
      if (cut) {
        doc.text(cut[0], mid + 8, y + 4, { width: 150 });
        doc.text(money(cut[1]), right - 78, y + 4, { width: 70, align: 'right' });
      }
      y += 16;
    }
    doc.rect(left, y, width, 18).fill('#111827');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    doc.text('TOTAL EARNINGS', left + 8, y + 5);
    doc.text(money(s.earnings), mid - 78, y + 5, { width: 70, align: 'right' });
    doc.text('TOTAL DEDUCTIONS', mid + 8, y + 5);
    doc.text(money(s.deductions), right - 78, y + 5, { width: 70, align: 'right' });
    y += 28;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11);
    doc.text(`NET EARNINGS :  ${money(s.net)}`, left, y);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#374151')
      .text(`( ${rupeesInWords(s.net)} )`, left, y + 16);
    doc.end();
  });
}
