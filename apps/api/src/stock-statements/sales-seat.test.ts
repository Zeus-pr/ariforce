import { describe, expect, it } from 'vitest';
import { salesSeat, type SeatHolder } from './sales-seat';

const holder = (over: Partial<SeatHolder> & Pick<SeatHolder, 'name' | 'path'>): SeatHolder => ({
  userId: over.name,
  status: 'active',
  hrStatus: null,
  ...over,
});

describe('sales seat', () => {
  const area = 'co.burdwan';
  const hq = 'co.burdwan.durgapur';

  it('keeps an active business manager on the headquarters', () => {
    const seat = salesSeat(
      [holder({ name: 'Sayak Kar', path: area }), holder({ name: 'Hriday Kumar Bari', path: hq })],
      hq,
    );
    expect(seat.vacant).toBe(false);
    expect(seat.people.map((person) => person.name)).toEqual(['Hriday Kumar Bari']);
  });

  it('leaves the headquarters vacant when that person is suspended', () => {
    const seat = salesSeat(
      [
        holder({ name: 'Sayak Kar', path: area }),
        holder({ name: 'Hriday Kumar Bari', path: hq, status: 'suspended' }),
      ],
      hq,
    );
    expect(seat).toMatchObject({ vacant: true, path: hq, people: [] });
  });

  it('uses the area manager when nobody is assigned on the headquarters', () => {
    const seat = salesSeat([holder({ name: 'Sayak Kar', path: area })], hq);
    expect(seat.vacant).toBe(false);
    expect(seat.people.map((person) => person.name)).toEqual(['Sayak Kar']);
  });
});
