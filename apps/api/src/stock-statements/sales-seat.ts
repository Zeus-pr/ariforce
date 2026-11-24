/** A person still attached to a place. A suspended or left person does not hold the seat. */
export type SeatHolder = {
  userId: string;
  name: string;
  path: string;
  status: string;
  hrStatus: string | null;
};

function holdsSeat(holder: SeatHolder) {
  if (holder.status !== 'active') return false;
  const hr = (holder.hrStatus ?? '').trim().toLowerCase();
  return hr !== 'left' && hr !== 'inactive' && hr !== 'suspended';
}

/** Deepest people on this place. An empty seat stays vacant instead of moving up to the manager. */
export function salesSeat(holders: SeatHolder[], path: string) {
  let best = 0;
  let hits: SeatHolder[] = [];
  for (const holder of holders) {
    if (path !== holder.path && !path.startsWith(`${holder.path}.`)) continue;
    const depth = holder.path.split('.').length;
    if (depth > best) {
      best = depth;
      hits = [holder];
    } else if (depth === best) hits.push(holder);
  }
  const active = hits.filter(holdsSeat);
  if (active.length) return { people: active, vacant: false as const, path: hits[0]!.path };
  if (hits.length) return { people: [], vacant: true as const, path: hits[0]!.path };
  return { people: [], vacant: false as const, path: '' };
}
