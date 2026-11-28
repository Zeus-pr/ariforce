import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyMonth,
  applyQuarter,
  applyYear,
  emptyMonths,
  gapPaise,
  idKey,
  parseRupees,
  readMonths,
  rupeesFromPaise,
  saveOps,
  sheetKey,
  splitPaise,
  spreadWeights,
  sumPaise,
  withMonths,
  type Sheet,
} from './target-sheet.ts';

const hq = 'hq-howrah';

describe('target sheet', () => {
  it('parses rupees and rejects a third decimal', () => {
    assert.equal(parseRupees(''), null);
    assert.equal(parseRupees('₹12,00,000'), 120_000_000);
    assert.equal(parseRupees('10.5'), 1050);
    assert.equal(parseRupees('10.555'), undefined);
    assert.equal(parseRupees('-1'), undefined);
  });

  it('splits a year into twelve equal months that add back', () => {
    const parts = splitPaise(
      120_000_000,
      Array.from({ length: 12 }, () => 1),
    );
    assert.equal(parts.length, 12);
    assert.ok(parts.every((n) => n === 10_000_000));
    assert.equal(
      parts.reduce((s, n) => s + n, 0),
      120_000_000,
    );
  });

  it('gives the leftover paise to the heavier months', () => {
    const parts = splitPaise(100, [0, 0, 0]);
    assert.equal(
      parts.reduce((s, n) => s + n, 0),
      100,
    );
    const weighted = splitPaise(10, [1, 0, 3]);
    assert.equal(
      weighted.reduce((sum, n) => sum + n, 0),
      10,
    );
    assert.equal(weighted[1], 0);
    assert.ok(weighted[2]! > weighted[0]!);
  });

  it('a year replaces every month and a quarter replaces only its three', () => {
    const year = applyYear(
      emptyMonths(),
      120_000_000,
      Array.from({ length: 12 }, () => 1),
    );
    assert.equal(sumPaise(year), 120_000_000);
    const quarter = applyQuarter(year, 1, 9_000_000, [1, 1, 1]);
    assert.equal(sumPaise(quarter.slice(3, 6)), 9_000_000);
    assert.equal(quarter[0], year[0]);
    assert.equal(quarter[6], year[6]);
    const cleared = applyQuarter(quarter, 1, null, [1, 1, 1]);
    assert.deepEqual(cleared.slice(3, 6), [null, null, null]);
  });

  it('clearing a month keeps the other months', () => {
    const filled = applyYear(emptyMonths(), 300, [1, 1, 1]);
    const next = applyMonth(filled, 1, null);
    assert.equal(next[0], filled[0]);
    assert.equal(next[1], null);
    assert.equal(next[2], filled[2]);
  });

  it('uses last year actuals, then last year targets, then an even split', () => {
    assert.deepEqual(spreadWeights([0, 5], [9, 9]), [0, 5]);
    assert.deepEqual(spreadWeights([0, 0], [2, 4]), [2, 4]);
    assert.deepEqual(spreadWeights([0, 0], [0, 0]), [1, 1]);
  });

  it('brand gap is the headquarters minus the brands', () => {
    assert.equal(gapPaise(1200, [500, null, 200]), 500);
    assert.equal(gapPaise(100, [150]), -50);
    assert.equal(gapPaise(null, [null, null]), null);
  });

  it('saves a changed month, deletes a cleared one, and skips the rest', () => {
    const before: Sheet = { cells: {} };
    const put = withMonths(before, hq, '', 'primary', applyMonth(emptyMonths(), 0, 10_000_000));
    const created = saveOps(2026, before, put, {});
    assert.equal(created.length, 1);
    assert.equal(created[0]?.op, 'put');
    if (created[0]?.op === 'put') {
      assert.equal(created[0].month, '2026-01');
      assert.equal(created[0].rupees, 100_000);
      assert.equal(created[0].brand, null);
      assert.equal(created[0].kind, 'primary');
    }
    const id = idKey(hq, '', 'primary', '2026-01');
    const cleared = saveOps(2026, put, { cells: {} }, { [id]: 'row-1' });
    assert.deepEqual(cleared, [{ op: 'delete', id: 'row-1' }]);
    assert.deepEqual(saveOps(2026, put, put, { [id]: 'row-1' }), []);
    const filled = applyYear(
      emptyMonths(),
      120_000_000,
      Array.from({ length: 12 }, () => 1),
    );
    const opened = applyMonth(filled, 5, null);
    const ops = saveOps(
      2026,
      { cells: {} },
      withMonths({ cells: {} }, hq, '', 'primary', opened),
      {},
    );
    assert.equal(ops.length, 11);
    assert.equal(
      ops.reduce((sum, op) => sum + (op.op === 'put' ? op.rupees : 0), 0),
      1_100_000,
    );
    assert.ok(ops.every((op) => op.op === 'put' && op.month !== '2026-06'));
    assert.equal(rupeesFromPaise(1), 0.01);
    assert.equal(
      readMonths(put, hq, '', 'secondary').every((n) => n == null),
      true,
    );
    assert.equal(sheetKey(hq, 'Amisalra', 'secondary').includes('Amisalra'), true);
  });
});
