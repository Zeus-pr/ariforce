/**
 * Copied EXACTLY from packages/contracts/src/schemas/products.ts productDisplayName()
 * on feat/dcr-pob-review @ c44b325 (the API derives Product.displayName with it). Keep in sync.
 */

/** A strength token: 50, 7.5, 10/0.25, 650mg (a number, optionally with a unit attached). */
const STRENGTH_TOKEN = /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*(?:mg|mcg|g|ml|iu|%)?$/i;
/** A unit written as its own word after a strength ('10 mg'). */
const UNIT_TOKEN = /^(?:mg|mcg|g|ml|iu|%)$/i;

/** Strength tokens are not a separate product field, so read them from the product name. */
export function productStrength(name: string): string | null {
  const words = name.trim().split(/\s+/).slice(1);
  const strengths: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (!STRENGTH_TOKEN.test(word)) continue;
    const unit = words[i + 1];
    strengths.push(UNIT_TOKEN.test(unit ?? '') ? `${word} ${words[++i]}` : word);
  }
  return strengths.length ? strengths.join(' + ') : null;
}

/**
 * Product name without strength numbers, for doctor detailing ('ARIPIX 10' -> 'ARIPIX',
 * 'ESCINEX CZ 10/0.25' -> 'ESCINEX CZ', 'NERGALIN 75 SR' -> 'NERGALIN SR', 'Paracetamol 650 mg'
 * -> 'Paracetamol'). The first word is always kept; letter variants (OD, ER, MD, CZ, D, M, F,
 * FORTE, PLUS, CD3...) are separate products and are kept. Whitespace is collapsed; case is kept.
 */
export function productDisplayName(name: string): string {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  const out = [first];
  let afterStrength = false;
  for (const w of rest) {
    if (STRENGTH_TOKEN.test(w) || (afterStrength && UNIT_TOKEN.test(w))) afterStrength = true;
    else {
      out.push(w);
      afterStrength = false;
    }
  }
  return out.join(' ');
}
