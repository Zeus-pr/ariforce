/**
 * Indian rupees with en-IN grouping (₹1,23,456.50), done by hand like format.ts so every
 * Hermes build prints the same thing (no Intl dependency).
 */
export function formatINR(n: number): string {
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toFixed(2).split('.') as [string, string];
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${neg ? '-' : ''}₹${grouped}.${dec}`;
}
