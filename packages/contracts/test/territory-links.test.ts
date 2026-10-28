import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Doctor,
  planTerritoryLinks,
  territoryKey,
  territoryLinkResult,
  type TerritoryLinkContext,
  type TerritoryLinkImportResult,
} from '../src';
import { createHandlers } from '../src/mocks';
import * as fx from '../src/mocks/fixtures';

const HQ = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
let n = 0;
const ctx = (over: Partial<TerritoryLinkContext> = {}): TerritoryLinkContext => ({
  territoryByCode: (c) =>
    c === 'HQ-DGP'
      ? { id: HQ, code: 'HQ-DGP', level: 'headquarter' }
      : c === 'AREA-1'
        ? { id: OTHER, code: 'AREA-1', level: 'area' }
        : undefined,
  territories: [],
  masters: [
    { entity: 'doctor', id: 'd1', hqId: HQ, name: 'Dr. Asha Roy', localTerritoryId: null },
    { entity: 'doctor', id: 'd2', hqId: HQ, name: 'B Sen', localTerritoryId: null },
    { entity: 'doctor', id: 'd3', hqId: HQ, name: 'b. sen', localTerritoryId: null },
    { entity: 'chemist', id: 'c1', hqId: HQ, name: 'Roy Medical', localTerritoryId: null },
  ],
  takenCodes: new Set(['HQ-DGP']),
  newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  ...over,
});
const row = (hq: string, entity: string, name: string, territory: string) => ({
  hq_code: hq,
  entity,
  name_key: name,
  territory_text: territory,
});

describe('territory link import planner', () => {
  it('normalises keys like ariforce_territory_key', () => {
    expect(territoryKey('  Durgapur  City ')).toBe('durgapur city');
    expect(territoryKey('DURGAPUR-City')).toBe('durgapur city');
    expect(territoryKey(' -- ')).toBeNull();
  });

  it('creates one territory per HQ + key, links, and reports unmatched / ambiguous / errors', () => {
    const rows = [
      row('hq-dgp', 'doctor', 'ASHA ROY', ' durgapur '),
      row('HQ-DGP', 'chemist', 'Roy Medical', 'DURGAPUR'),
      row('HQ-DGP', 'doctor', 'B SEN', 'Arambagh'),
      row('HQ-NOPE', 'doctor', 'Asha Roy', 'Durgapur'),
      row('AREA-1', 'doctor', 'Asha Roy', 'Durgapur'),
      row('HQ-DGP', 'doctor', 'Nobody', 'Durgapur'),
      row('HQ-DGP', 'stockist', 'X', 'Durgapur'),
      row('HQ-DGP', 'doctor', 'Asha Roy', ''),
    ];
    const plan = planTerritoryLinks(rows, ctx());
    const r = territoryLinkResult(plan, { dryRun: true, onLinked: 'keep' });
    expect(r.results.map((x) => [x.status, x.reason])).toEqual([
      ['linked', null],
      ['linked', null],
      ['unmatched', 'ambiguous'],
      ['unmatched', 'unknown_hq'],
      ['unmatched', 'not_headquarter'],
      ['unmatched', 'no_match'],
      ['error', 'invalid_entity'],
      ['skipped', 'blank_territory'],
    ]);
    expect(r.results[2]!.candidateIds).toEqual(['d2', 'd3']);
    expect(r.territoriesCreated).toEqual([
      expect.objectContaining({ id: null, code: 'HQ-DGP-DURGAPUR', name: 'Durgapur', rows: 2 }),
    ]);
    expect(r.totals).toMatchObject({
      linked: 2,
      doctorsLinked: 1,
      chemistsLinked: 1,
      territoriesCreated: 1,
      unknownHq: 2,
      noMatch: 1,
      ambiguous: 1,
      error: 1,
      skipped: 1,
    });
  });

  it('is idempotent: existing territory + existing link -> already_linked, nothing created', () => {
    const t = {
      id: 't1',
      parentId: HQ,
      key: 'durgapur',
      code: 'HQ-DGP-DURGAPUR',
      name: 'Durgapur',
    };
    const c = ctx({ territories: [t] });
    c.masters[0]!.localTerritoryId = 't1';
    const plan = planTerritoryLinks([row('HQ-DGP', 'doctor', 'Asha Roy', 'DURGAPUR')], c);
    expect(plan.create).toEqual([]);
    expect(plan.links).toEqual([]);
    expect(plan.results[0]).toMatchObject({ status: 'already_linked', territoryId: 't1' });
  });

  it('flags in-file conflicts and duplicates; keeps other links unless replace', () => {
    const c = ctx();
    c.masters[3]!.localTerritoryId = 'elsewhere';
    const rows = [
      row('HQ-DGP', 'doctor', 'Asha Roy', 'Durgapur'),
      row('HQ-DGP', 'doctor', 'Dr Asha Roy', 'Indus'),
      row('HQ-DGP', 'chemist', 'Roy Medical', 'Durgapur'),
      row('HQ-DGP', 'chemist', 'ROY  MEDICAL', 'durgapur'),
    ];
    const kept = planTerritoryLinks(rows, c).results.map((x) => x.reason);
    expect(kept).toEqual([
      'conflict_in_file',
      'conflict_in_file',
      'linked_elsewhere',
      'duplicate_in_file',
    ]);
    const rep = planTerritoryLinks(rows, ctx({ masters: c.masters }), 'replace').results[2]!;
    expect(rep).toMatchObject({ status: 'linked', previousTerritoryId: 'elsewhere' });
  });
});

describe('mock POST /v1/imports/territory-links + localTerritoryId filter', () => {
  const BASE = 'http://links.test';
  const server = setupServer(...createHandlers(BASE));
  beforeAll(() => server.listen());
  afterAll(() => server.close());
  const post = (body: unknown, who = 'director') =>
    fetch(`${BASE}/v1/imports/territory-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mock-user': who },
      body: JSON.stringify(body),
    });

  it('dry run, apply, re-run; DTO field and filter', async () => {
    const area = fx.territories.find((t) => t.level === 'area')!;
    const rows = [row(area.code, 'doctor', fx.doctors[0]!.name, 'Salt Lake')];
    expect((await post({ rows }, 'bm')).status).toBe(403);
    const dry = await post({ rows });
    expect(dry.status).toBe(200);
    expect(((await dry.json()) as TerritoryLinkImportResult).totals.linked).toBe(1);
    const app = await post({ rows, dryRun: false });
    expect(app.status).toBe(201);
    const a = (await app.json()) as TerritoryLinkImportResult;
    expect(a.totals).toMatchObject({ linked: 1, territoriesCreated: 1 });
    const tid = a.territoriesCreated[0]!.id!;
    const again = (await (await post({ rows, dryRun: false })).json()) as TerritoryLinkImportResult;
    expect(again.totals).toMatchObject({ linked: 0, alreadyLinked: 1, territoriesCreated: 0 });
    const list = (await (
      await fetch(`${BASE}/v1/doctors?localTerritoryId=${tid}`, {
        headers: { 'x-mock-user': 'director' },
      })
    ).json()) as { items: Doctor[] };
    expect(list.items.map((d: Doctor) => d.id)).toEqual([fx.doctors[0]!.id]);
    expect(Doctor.parse(list.items[0]).localTerritoryId).toBe(tid);
    const none = (await (
      await fetch(`${BASE}/v1/doctors?localTerritoryId=none`, {
        headers: { 'x-mock-user': 'director' },
      })
    ).json()) as { items: Doctor[] };
    expect(none.items.map((d: Doctor) => d.id)).not.toContain(fx.doctors[0]!.id);
  });
});
