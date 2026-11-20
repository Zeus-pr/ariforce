import { describe, expect, it } from 'vitest';
import {
  OutletPlaceError,
  placeOutletTerritory,
  type OutletPlace,
} from '../src/masters/outlet-territory';

const hq: OutletPlace = { id: 'hq', parentId: 'area', level: 'headquarter' };
const town: OutletPlace = { id: 'town', parentId: 'hq', level: 'territory' };
const otherHq: OutletPlace = { id: 'hq2', parentId: 'area', level: 'headquarter' };
const other: OutletPlace = { id: 'other', parentId: 'hq2', level: 'territory' };
const byId = new Map([hq, town, otherHq, other].map((r) => [r.id, r]));

describe('placeOutletTerritory', () => {
  it('keeps a headquarters and the territory under it', () => {
    expect(placeOutletTerritory('hq', 'town', byId)).toEqual({
      territoryId: 'hq',
      localTerritoryId: 'town',
    });
  });

  it('stores a town sent as the headquarters on the territory, under its parent', () => {
    expect(placeOutletTerritory('town', null, byId)).toEqual({
      territoryId: 'hq',
      localTerritoryId: 'town',
    });
  });

  it('leaves a headquarters with no territory', () => {
    expect(placeOutletTerritory('hq', null, byId)).toEqual({
      territoryId: 'hq',
      localTerritoryId: null,
    });
  });

  it('rejects a territory under a different headquarters', () => {
    expect(() => placeOutletTerritory('hq', 'other', byId)).toThrow(OutletPlaceError);
  });
});
