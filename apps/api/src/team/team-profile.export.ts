import type { TeamPerformance, TeamProfile } from '@ariforce/contracts';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/** Same pattern as expenses/export.util.ts. No phone/email in exports (minimal PII). */
export interface ProfileExport {
  profile: TeamProfile;
  perf: TeamPerformance;
}

const fmt = (v: number | null) => (v === null ? '' : String(v));

function header(d: ProfileExport): [string, string][] {
  const m = d.profile.member;
  return [
    ['Name', m.name],
    ['Employee code', m.employeeCode ?? ''],
    ['Role', m.role ?? ''],
    ['Designation', m.designation ?? ''],
    ['Manager', d.profile.manager?.name ?? ''],
    ['HQ', d.profile.hq?.name ?? ''],
    ['Doctors', String(d.profile.counts.doctors)],
    ['Chemists', String(d.profile.counts.chemists)],
    ['Direct reports', String(d.profile.counts.directReports)],
    ['Period', `${d.perf.from} to ${d.perf.to} (${d.perf.granularity})`],
  ];
}

export async function profileXlsx(d: ProfileExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AriForce';
  const s = wb.addWorksheet('Profile');
  s.columns = [
    { header: 'Field', key: 'k', width: 18 },
    { header: 'Value', key: 'v', width: 40 },
  ];
  for (const [k, v] of header(d)) s.addRow({ k, v });
  s.getRow(1).font = { bold: true };
  const p = wb.addWorksheet('Performance');
  const rowsAll = [...d.perf.buckets, d.perf.total];
  const kpis = d.perf.total.metrics.map((m) => m.kpi);
  p.columns = [
    { header: 'Period', key: 'label', width: 12 },
    { header: 'From', key: 'from', width: 12 },
    { header: 'To', key: 'to', width: 12 },
    { header: 'Working days', key: 'wd', width: 13 },
    { header: 'Present', key: 'present', width: 9 },
    { header: 'Leave', key: 'leave', width: 8 },
    { header: 'Holiday', key: 'holiday', width: 9 },
    { header: 'Absent', key: 'absent', width: 8 },
    ...kpis.map((k) => ({ header: k, key: k, width: 14 })),
    ...(d.perf.total.expenses
      ? [
          { header: 'Expenses claimed (INR)', key: 'claimed', width: 20 },
          { header: 'Expenses approved (INR)', key: 'approved', width: 20 },
        ]
      : []),
  ];
  for (const b of rowsAll)
    p.addRow({
      label: b.label,
      from: b.from,
      to: b.to,
      wd: b.workingDays,
      present: b.attendance.presentDays,
      leave: b.attendance.leaveDays,
      holiday: b.attendance.holidayDays,
      absent: b.attendance.absentDays,
      ...Object.fromEntries(b.metrics.map((m) => [m.kpi, m.value])),
      claimed: b.expenses?.claimed,
      approved: b.expenses?.approved,
    });
  p.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function profilePdf(d: ProfileExport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
      info: { Title: `Team profile ${d.profile.member.name}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(`Team member profile: ${d.profile.member.name}`);
    doc.fontSize(10).moveDown(0.5);
    for (const [k, v] of header(d)) doc.text(`${k}: ${v}`);
    doc.moveDown();
    const cols = [
      'Period',
      'Present',
      'Leave',
      'Absent',
      ...d.perf.total.metrics.map((m) => m.kpi),
    ];
    if (d.perf.total.expenses) cols.push('Claimed', 'Approved');
    const w = (806 - 36) / cols.length;
    const row = (vals: string[], bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 6 : 7);
      vals.forEach((v, i) => doc.text(v, 36 + i * w, y, { width: w - 2 }));
      doc.moveDown(0.4);
      if (doc.y > 540) doc.addPage();
    };
    row(
      cols.map((c) => c.replace(/_/g, ' ')),
      true,
    );
    for (const b of [...d.perf.buckets, d.perf.total])
      row([
        b.label,
        String(b.attendance.presentDays),
        String(b.attendance.leaveDays),
        String(b.attendance.absentDays),
        ...b.metrics.map((m) => fmt(m.value)),
        ...(b.expenses ? [b.expenses.claimed.toFixed(2), b.expenses.approved.toFixed(2)] : []),
      ]);
    doc.end();
  });
}
