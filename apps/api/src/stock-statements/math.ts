/** Paise, half up, for a non-negative quantity and a PTS. */
export function lineValue(qty: number, pts: number): number {
  return Math.round(qty * pts * 100) / 100;
}

export function addMoney(a: number, b: number): number {
  return Math.round((a + b) * 100) / 100;
}

export type QtyLine = {
  openingQty: number | null;
  purchaseQty: number;
  secondaryQty: number;
  frsQty: number;
  pts: number | null;
};

export type FiguredLine = QtyLine & {
  openingValue: number | null;
  purchaseValue: number | null;
  secondaryValue: number | null;
  frsValue: number | null;
  closingQty: number | null;
  closingValue: number | null;
};

export function figureLine(line: QtyLine): FiguredLine {
  const value = (qty: number | null) =>
    qty == null || line.pts == null ? null : lineValue(qty, line.pts);
  const closingQty =
    line.openingQty == null
      ? null
      : line.openingQty + line.purchaseQty - line.secondaryQty - line.frsQty;
  return {
    ...line,
    openingValue: value(line.openingQty),
    purchaseValue: value(line.purchaseQty),
    secondaryValue: value(line.secondaryQty),
    frsValue: value(line.frsQty),
    closingQty,
    closingValue: value(closingQty),
  };
}

export type StatementTotals = {
  openingQty: number;
  openingValue: number;
  purchaseQty: number;
  purchaseValue: number;
  secondaryQty: number;
  secondaryValue: number;
  closingQty: number;
  closingValue: number;
  frsQty: number;
  frsValue: number;
  actualSecondary: number;
};

export function totalsOf(lines: FiguredLine[]): StatementTotals {
  const t: StatementTotals = {
    openingQty: 0,
    openingValue: 0,
    purchaseQty: 0,
    purchaseValue: 0,
    secondaryQty: 0,
    secondaryValue: 0,
    closingQty: 0,
    closingValue: 0,
    frsQty: 0,
    frsValue: 0,
    actualSecondary: 0,
  };
  for (const line of lines) {
    if (line.openingQty != null) t.openingQty += line.openingQty;
    if (line.openingValue != null) t.openingValue = addMoney(t.openingValue, line.openingValue);
    t.purchaseQty += line.purchaseQty;
    if (line.purchaseValue != null) t.purchaseValue = addMoney(t.purchaseValue, line.purchaseValue);
    t.secondaryQty += line.secondaryQty;
    if (line.secondaryValue != null)
      t.secondaryValue = addMoney(t.secondaryValue, line.secondaryValue);
    if (line.closingQty != null && line.closingQty > 0) t.closingQty += line.closingQty;
    else if (line.closingQty != null) t.closingQty += line.closingQty;
    if (line.closingValue != null) t.closingValue = addMoney(t.closingValue, line.closingValue);
    t.frsQty += line.frsQty;
    if (line.frsValue != null) t.frsValue = addMoney(t.frsValue, line.frsValue);
  }
  t.actualSecondary = addMoney(t.secondaryValue, -t.frsValue);
  return t;
}

/** First day of the calendar month after YYYY-MM-01. */
export function nextMonth(month: string): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function monthStart(month: string): string {
  return `${month.slice(0, 7)}-01`;
}
