import { describe, expect, it } from 'vitest';
import { dayTaDa, sectionTaDa } from './section-ta-da';

const route = (id: string, ta: number | null, da: number | null) => ({
  id,
  bothWayAmount: ta,
  da,
});

describe('section and day TA/DA', () => {
  it('adds both-way TA and keeps the greatest DA in a section', () => {
    expect(sectionTaDa([route('a', 100, 40), route('b', 50, 80), route('c', null, null)])).toEqual({
      ta: 150,
      da: 80,
    });
  });

  it('adds each route once across sections and keeps one DA', () => {
    expect(
      dayTaDa([
        [route('a', 100, 40), route('b', 50, 80)],
        [route('b', 50, 80), route('c', 20, 30)],
      ]),
    ).toEqual({ ta: 170, da: 80 });
  });
});
