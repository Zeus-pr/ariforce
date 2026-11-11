import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SFC_SHEET_HEADERS, sfcRoutesToSheet, sfcSheetToRoutes } from './sheet.ts';

const headers = [...SFC_SHEET_HEADERS];

describe('SFC sheet', () => {
  it('round-trips a route, including an actual fare', () => {
    const sheet = sfcRoutesToSheet([
      {
        fromPlace: 'ASANSOL',
        toPlace: 'LYANI',
        distanceKm: 12,
        actualFare: false,
        travelMode: 'BIKE',
        category: 'HQ',
        da: 300,
      },
      {
        fromPlace: 'ASANSOL',
        toPlace: 'SURI',
        distanceKm: 0,
        actualFare: true,
        travelMode: 'BUS / TRAIN',
        category: 'EX',
        da: null,
      },
    ]);
    const back = sfcSheetToRoutes([
      ['SFC · Someone'],
      headers,
      ...sheet.map((r) => r.map((c) => (c == null ? '' : String(c)))),
    ]);
    assert.equal(back.error, null);
    assert.equal(back.routes[0]?.category, 'HQ');
    assert.equal(back.routes[0]?.distanceKm, 12);
    assert.equal(back.routes[0]?.da, 300);
    assert.equal(back.routes[1]?.actualFare, true);
    assert.equal(back.routes[1]?.da, null);
  });

  it('rejects a row with no destination', () => {
    const back = sfcSheetToRoutes([headers, ['ASANSOL', '', '10', 'No', 'BIKE', 'HQ', '']]);
    assert.match(back.error ?? '', /To place/);
    assert.equal(back.routes.length, 0);
  });
});
