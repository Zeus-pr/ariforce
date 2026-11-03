import { describe, expect, it } from 'vitest';
import { groupDetailProducts, productDisplayName, type DcrProductOption } from '../src';

describe('productDisplayName', () => {
  it.each([
    ['ARIPIX 10', 'ARIPIX'],
    ['AMISALRA OD 100', 'AMISALRA OD'],
    ['ESCINEX CZ 10/0.25', 'ESCINEX CZ'],
    ['NEXOZEP MD 0.25', 'NEXOZEP MD'],
    ['MIRQUIL 7.5', 'MIRQUIL'],
    ['NERGALIN 75 SR', 'NERGALIN SR'],
    ['NERGALIN D 50/20', 'NERGALIN D'],
    ['MEVALIN CD3', 'MEVALIN CD3'],
    ['DVENLIXA FORTE', 'DVENLIXA FORTE'],
    ['CITIZEM', 'CITIZEM'],
    ['Paracetamol 650 mg', 'Paracetamol'],
    ['Ariclav 625', 'Ariclav'],
    ['Ariclav 625mg', 'Ariclav'],
    ['  LEVIROX   1000 ', 'LEVIROX'],
    ['5 ALPHA 10', '5 ALPHA'],
  ])('%s -> %s', (name, want) => expect(productDisplayName(name)).toBe(want));
});

describe('groupDetailProducts', () => {
  const p = (id: string, name: string, img: string | null): DcrProductOption => ({
    id,
    divisionId: id,
    code: id,
    name,
    displayName: productDisplayName(name),
    brand: name,
    composition: `${name} comp`,
    packSize: "10'S",
    form: 'tablet',
    mrp: null,
    pts: null,
    isSample: false,
    imageFileKey: img,
    imageUrl: img ? `https://img/${img}` : null,
  });
  it('one entry per displayName; productId = first SKU with a picture, else the first', () => {
    const g = groupDetailProducts([
      p('a1', 'ARIPIX 10', null),
      p('a2', 'ARIPIX 2', 'k2'),
      p('a3', 'ARIPIX 5', 'k3'),
      p('l1', 'LORJIM 1', null),
      p('l2', 'LORJIM 2', null),
    ]);
    expect(g.map((x) => [x.displayName, x.productId, x.productIds, x.imageUrl])).toEqual([
      ['ARIPIX', 'a2', ['a1', 'a2', 'a3'], 'https://img/k2'],
      ['LORJIM', 'l1', ['l1', 'l2'], null],
    ]);
    expect(g[0]!.composition).toBe('ARIPIX 2 comp');
  });
});
