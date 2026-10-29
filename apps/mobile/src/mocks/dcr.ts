/**
 * ============================================================================================
 * MOCKS FOR DCR FIELDS AND ENDPOINTS NOT YET IN @ariforce/contracts.
 * ============================================================================================
 * Only src/lib/dcr/adapter.ts imports this file. Each block says which contract field or
 * endpoint it stands in for. When Architect ships it, flip the matching CONTRACT flag in the
 * adapter (or delete the mock) — screens never read these directly.
 *
 * Stored on this device only (expo-secure-store), so a manager's decision is visible to a rep
 * only when both sign in on the same phone. That is expected until the API lands.
 * ============================================================================================
 */
import * as SecureStore from 'expo-secure-store';

// ---- 1. Product.imageUrl (TODO: switch to the real contract field) -------------------------
/**
 * Demo artwork for the presentation: two of every three products get a placeholder image,
 * the third gets none, so the name-only slide is exercised too.
 */
export function mockProductImageUrl(p: { id: string; name: string; code?: string }): string | null {
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  if (h % 3 === 0) return null;
  const text = encodeURIComponent(p.name.slice(0, 24));
  return `https://placehold.co/900x1200/0F2A4A/FFFFFF/png?text=${text}`;
}

// ---- 2. DcrCall.presentationOpenedAt (TODO: switch to the real contract field) -------------
/** Doctor calls whose presentation was opened, per DCR date, keyed by doctor (outletId). */
const presKey = (date: string) => `ariforce.mock.dcr-pres.${date}`;

export async function mockLoadPresentation(date: string): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(presKey(date));
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function mockSavePresentation(date: string, outletIds: string[]) {
  await SecureStore.setItemAsync(presKey(date), JSON.stringify([...new Set(outletIds)]));
}

// ---- 3. Dcr.status 'approved' | 'rejected' + Dcr.rejectionReason -----------------------------
// ---- 4. POST /v1/dcrs/:id/decision { decision, comment } (TODO: real endpoint) ---------------
export type MockDecision = {
  status: 'approved' | 'rejected';
  reason: string | null;
  decidedAt: string;
};
const DECISIONS_KEY = 'ariforce.mock.dcr-decisions';

export async function mockLoadDecisions(): Promise<Record<string, MockDecision>> {
  const raw = await SecureStore.getItemAsync(DECISIONS_KEY);
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? (v as Record<string, MockDecision>) : {};
  } catch {
    return {};
  }
}

export async function mockDecide(
  id: string,
  decision: 'approve' | 'reject',
  comment: string | null,
): Promise<MockDecision> {
  const all = await mockLoadDecisions();
  const d: MockDecision = {
    status: decision === 'approve' ? 'approved' : 'rejected',
    reason: decision === 'reject' ? comment : null,
    decidedAt: new Date().toISOString(),
  };
  all[id] = d;
  // Keep the store small (secure-store values should stay well under 2 KB).
  const trimmed = Object.fromEntries(
    Object.entries(all)
      .sort((a, b) => b[1].decidedAt.localeCompare(a[1].decidedAt))
      .slice(0, 15),
  );
  await SecureStore.setItemAsync(DECISIONS_KEY, JSON.stringify(trimmed));
  return d;
}
