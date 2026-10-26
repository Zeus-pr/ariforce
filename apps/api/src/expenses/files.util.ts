import { EXPENSE_FILE_TYPES, type ExpenseContentType } from '@ariforce/contracts';

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const HEIF_BRANDS = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
];

/**
 * Format check on the first bytes of an upload (magic numbers). Not a virus scan: it only proves
 * the bytes match the declared type, so e.g. an .exe renamed to .pdf is rejected.
 */
export function sniffMatches(type: ExpenseContentType, b: Uint8Array): boolean {
  switch (type) {
    case 'image/jpeg':
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/heic':
    case 'image/heif': {
      if (!startsWith(b, ascii('ftyp'), 4)) return false;
      const brand = String.fromCharCode(...b.slice(8, 12));
      return HEIF_BRANDS.includes(brand);
    }
    case 'application/pdf':
      return startsWith(b, ascii('%PDF-'));
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
    case 'application/vnd.ms-excel':
      return startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'text/csv': {
      if (!b.length) return false;
      for (const x of b)
        if (x === 0 || (x < 0x20 && x !== 0x09 && x !== 0x0a && x !== 0x0d)) return false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(b.slice(0, Math.max(0, b.length - 3)));
      } catch {
        return false;
      }
      return true;
    }
  }
}

/** Canonical extension used in the R2 key. */
export const keyExt = (t: ExpenseContentType) => EXPENSE_FILE_TYPES[t][0];
