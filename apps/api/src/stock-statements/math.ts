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
  freeQty: number;
  secondaryQty: number;
  frsQty: number;
  pts: number | null;
};

export type FiguredLine = QtyLine & {
  openingValue: number | null;
  purchaseValue: number | null;
  freeValue: number | null;
  secondaryValue: number | null;
  frsValue: number | null;
  closingQty: number | null;
  closingValue: number | null;
};

export function figureLine(line: QtyLine): FiguredLine {
  const value = (qty: number | null) =>
    qty == null ? null : line.pts == null ? 0 : lineValue(qty, line.pts);
  const closingQty =
    line.openingQty == null
      ? null
      : line.openingQty + line.purchaseQty + line.freeQty - line.secondaryQty - line.frsQty;
  return {
    ...line,
    openingValue: value(line.openingQty),
    purchaseValue: value(line.purchaseQty),
    freeValue: value(line.freeQty),
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
  freeQty: number;
  freeValue: number;
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
    freeQty: 0,
    freeValue: 0,
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
    t.freeQty += line.freeQty;
    if (line.freeValue != null) t.freeValue = addMoney(t.freeValue, line.freeValue);
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

/** 23:59:59.999 on the 6th of the next month, in the company timezone. */
export function lockInstant(month: string, timeZone: string): Date {
  const [y, m] = month.slice(0, 7).split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const day = `${ny}-${String(nm).padStart(2, '0')}-06`;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let t = Date.parse(`${day}T23:59:59.999Z`);
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const got = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.999Z`,
    );
    t += Date.parse(`${day}T23:59:59.999Z`) - got;
  }
  return new Date(t);
}

/** Months before the site opened are catch-up. The 6th lock starts with November 2026. */
const FIRST_LOCKED_MONTH = '2026-11';

export function isPastLock(month: string, now: Date, timeZone: string) {
  if (month.slice(0, 7) < FIRST_LOCKED_MONTH) return false;
  return now.getTime() > lockInstant(month, timeZone).getTime();
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
