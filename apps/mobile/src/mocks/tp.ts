/**
 * ============================================================================================
 * MOCK TOUR-PLAN STORE (until Architect ships the TP item API). Only src/lib/tp/adapter.ts uses
 * it. Kept on this device (expo-secure-store): a manager sees a rep's TP only on the same phone.
 * One key per item plus an index, so no single value grows past secure-store's ~2 KB comfort.
 * ============================================================================================
 */
import * as SecureStore from 'expo-secure-store';
import type { TpItem } from '@/lib/tp/adapter';

const INDEX = 'ariforce.mock.tp.index';
const itemKey = (id: string) => `ariforce.mock.tp.item.${id}`;
const MAX_ITEMS = 40;

async function readIndex(): Promise<string[]> {
  try {
    const v: unknown = JSON.parse((await SecureStore.getItemAsync(INDEX)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function mockListTps(): Promise<TpItem[]> {
  const ids = await readIndex();
  const out: TpItem[] = [];
  for (const id of ids) {
    const raw = await SecureStore.getItemAsync(itemKey(id));
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as TpItem);
    } catch {
      // skip a broken entry
    }
  }
  return out;
}

export async function mockGetTp(id: string): Promise<TpItem | null> {
  const raw = await SecureStore.getItemAsync(itemKey(id));
  return raw ? (JSON.parse(raw) as TpItem) : null;
}

export async function mockPutTp(item: TpItem): Promise<TpItem> {
  await SecureStore.setItemAsync(itemKey(item.id), JSON.stringify(item));
  const ids = [item.id, ...(await readIndex()).filter((x) => x !== item.id)];
  for (const old of ids.slice(MAX_ITEMS)) await SecureStore.deleteItemAsync(itemKey(old));
  await SecureStore.setItemAsync(INDEX, JSON.stringify(ids.slice(0, MAX_ITEMS)));
  return item;
}

export async function mockDeleteTp(id: string) {
  await SecureStore.deleteItemAsync(itemKey(id));
  await SecureStore.setItemAsync(
    INDEX,
    JSON.stringify((await readIndex()).filter((x) => x !== id)),
  );
}
