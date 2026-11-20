export type OutletPlace = {
  id: string;
  parentId: string | null;
  level: string;
};

export class OutletPlaceError extends Error {}

/**
 * Doctors and chemists keep the headquarters on territoryId and the town on localTerritoryId.
 * A town sent as territoryId is stored as the town, and its parent headquarters becomes territoryId.
 */
export function placeOutletTerritory(
  territoryId: string,
  localTerritoryId: string | null,
  byId: Map<string, OutletPlace>,
): { territoryId: string; localTerritoryId: string | null } {
  const chosen = byId.get(territoryId);
  if (!chosen) throw new OutletPlaceError('Choose a headquarters.');
  let hqId = territoryId;
  let local = localTerritoryId;
  if (chosen.level === 'territory') {
    const parent = chosen.parentId ? byId.get(chosen.parentId) : undefined;
    if (!parent || parent.level !== 'headquarter')
      throw new OutletPlaceError('Choose a territory under a headquarters.');
    if (local && local !== chosen.id) throw new OutletPlaceError('Choose one territory.');
    hqId = parent.id;
    local = chosen.id;
  }
  if (!local) return { territoryId: hqId, localTerritoryId: null };
  const town = byId.get(local);
  if (!town || town.level !== 'territory' || town.parentId !== hqId)
    throw new OutletPlaceError('That territory is not under this HQ.');
  return { territoryId: hqId, localTerritoryId: local };
}
