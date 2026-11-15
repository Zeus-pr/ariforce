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

const A4_LANDSCAPE_W = 841.89;
const A4_H = 595.28;
const PDF_MARGIN_X = 32;

function pdfColumnWidths(
  doc: {
    setFont: (family: string, style: string) => unknown;
    setFontSize: (size: number) => unknown;
    getTextWidth: (text: string) => number;
  },
  spec: ExportSpec,
) {
  doc.setFontSize(9);
  return spec.columns.map((col, i) => {
    doc.setFont('helvetica', 'bold');
    const header = doc.getTextWidth(col.header) + 16;
    doc.setFont('helvetica', 'normal');
    let content = 0;
    for (const row of spec.rows) {
      const v = row[i];
      if (v == null || v === '') continue;
      const s = typeof v === 'number' ? v.toLocaleString('en-IN') : String(v);
      content = Math.max(content, doc.getTextWidth(s));
    }
    return Math.max(header, Math.min(content + 16, 160));
  });
}

export async function exportPdf(spec: ExportSpec) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const probe = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const widths = pdfColumnWidths(probe, spec);
  const needed = widths.reduce((sum, w) => sum + w, 0) + PDF_MARGIN_X * 2;
  const wide = needed > A4_LANDSCAPE_W;
  const doc = new jsPDF({
    orientation: wide || spec.columns.length > 6 ? 'landscape' : 'portrait',
    unit: 'pt',
    format: wide ? [needed, A4_H] : 'a4',
  });
  if (wide) doc.setDisplayMode('fullheight', 'continuous');
  const x = PDF_MARGIN_X;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(spec.title, x, 48);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  spec.meta.forEach((m, i) => doc.text(m, x, 66 + i * 12));
  autoTable(doc, {
    startY: 76 + spec.meta.length * 12,
    margin: { top: 36, right: PDF_MARGIN_X, bottom: 28, left: PDF_MARGIN_X },
    head: [spec.columns.map((c) => c.header)],
    body: spec.rows.map((r) =>
      r.map((v) => (v === null ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN') : v)),
    ),
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 5,
      textColor: 30,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: 30,
      fontStyle: 'bold',
      overflow: 'linebreak',
    },
    columnStyles: Object.fromEntries(
      spec.columns.map((c, i) => [
        i,
        { halign: c.align ?? 'left', ...(wide ? { cellWidth: widths[i] } : {}) },
      ]),
    ),
    tableWidth: wide ? widths.reduce((sum, w) => sum + w, 0) : 'auto',
    theme: 'grid',
  });
  save(doc.output('blob'), `${spec.fileName}.pdf`);
}
