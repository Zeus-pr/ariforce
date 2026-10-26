'use client';

/**
 * Client-side export of the current view. Libraries load only on click.
 * xlsx: write-excel-file (MIT, universal build -> Blob). PDF: jsPDF + jspdf-autotable (MIT).
 */
export type ExportCol = { header: string; width?: number; align?: 'left' | 'right' };
export type ExportCell = string | number | null;
export type ExportSpec = {
  title: string;
  /** Lines under the title: scope, period, notes. */
  meta: string[];
  columns: ExportCol[];
  rows: ExportCell[][];
  fileName: string;
};

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportXlsx(spec: ExportSpec) {
  const { default: writeXlsxFile } = await import('write-excel-file/universal');
  const width = spec.columns.length;
  const pad = (cells: object[]) => [
    ...cells,
    ...Array(Math.max(0, width - cells.length)).fill(null),
  ];
  const data = [
    pad([{ value: spec.title, fontWeight: 'bold', fontSize: 14 }]),
    ...spec.meta.map((m) => pad([{ value: m, color: '#666666' }])),
    pad([]),
    spec.columns.map((c) => ({
      value: c.header,
      fontWeight: 'bold',
      align: c.align ?? 'left',
      bottomBorderStyle: 'thin',
    })),
    ...spec.rows.map((r) =>
      r.map((v, i) =>
        v === null
          ? null
          : {
              value: v,
              type: typeof v === 'number' ? Number : String,
              align: spec.columns[i]?.align ?? 'left',
            },
      ),
    ),
  ];
  const blob = await writeXlsxFile(
    data as never,
    { columns: spec.columns.map((c) => ({ width: c.width ?? 16 })) } as never,
  ).toBlob();
  save(blob, `${spec.fileName}.xlsx`);
}

export async function exportPdf(spec: ExportSpec) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({
    orientation: spec.columns.length > 6 ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(spec.title, 40, 48);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  spec.meta.forEach((m, i) => doc.text(m, 40, 66 + i * 12));
  autoTable(doc, {
    startY: 76 + spec.meta.length * 12,
    head: [spec.columns.map((c) => c.header)],
    body: spec.rows.map((r) =>
      r.map((v) => (v === null ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN') : v)),
    ),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: 30 },
    headStyles: { fillColor: [245, 245, 245], textColor: 30, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(
      spec.columns.map((c, i) => [i, { halign: c.align ?? 'left' }]),
    ),
    theme: 'grid',
  });
  save(doc.output('blob'), `${spec.fileName}.pdf`);
}
