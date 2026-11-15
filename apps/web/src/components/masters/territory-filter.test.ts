import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { masterTerritoryFilterOptions } from './territory-filter.ts';

describe('master territory filter', () => {
  const rows = [
    { id: 'area', name: 'Burdwan', level: 'area', parentId: 'wb' },
    { id: 'wb', name: 'West Bengal', level: 'national', parentId: null },
    { id: 'anamoy', name: 'Burdwan Anamoy', level: 'headquarter', parentId: 'area' },
    { id: 'patch-a', name: 'Burdwan', level: 'territory', parentId: 'anamoy' },
    { id: 'patch-b', name: 'Burdwan', level: 'territory', parentId: 'bmch' },
    { id: 'bmch', name: 'Burdwan Bmch', level: 'headquarter', parentId: 'area' },
    { id: 'hq', name: 'Durgapur', level: 'headquarter', parentId: 'wb' },
    { id: 'patch-d', name: 'Durgapur', level: 'territory', parentId: 'hq' },
  ];

  it('hides patches and keeps the area and headquarters ids', () => {
    const options = masterTerritoryFilterOptions(rows);
    const ids = options.map((o) => o.value);
    assert.deepEqual(ids, ['area', 'anamoy', 'bmch', 'hq', 'wb']);
    assert.equal(options.find((o) => o.value === 'area')?.label, 'Burdwan');
    assert.equal(options.find((o) => o.value === 'hq')?.label, 'Durgapur');
  });

  it('adds the level and parent when two visible rows share a name', () => {
    const options = masterTerritoryFilterOptions([
      { id: 'a1', name: 'Burdwan', level: 'area', parentId: 'wb' },
      { id: 'wb', name: 'West Bengal', level: 'national', parentId: null },
      { id: 'a2', name: 'Burdwan', level: 'headquarter', parentId: 'wb' },
    ]);
    const byId = Object.fromEntries(options.map((o) => [o.value, o.label]));
    assert.equal(byId.a1, 'Burdwan · area, West Bengal');
    assert.equal(byId.a2, 'Burdwan · HQ, West Bengal');
  });
});
