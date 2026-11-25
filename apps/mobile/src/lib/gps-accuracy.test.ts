/// <reference types="jest" />
import { accuracyMetres } from '@/lib/gps-accuracy';

describe('accuracyMetres', () => {
  it('sends the reading the device reported', () => {
    expect(accuracyMetres(18.4)).toBe(18);
    expect(accuracyMetres(0)).toBe(0);
  });

  it('refuses a missing or negative accuracy instead of inventing 100 m', () => {
    expect(() => accuracyMetres(null)).toThrow(/accuracy/i);
    expect(() => accuracyMetres(undefined)).toThrow(/accuracy/i);
    expect(() => accuracyMetres(-1)).toThrow(/accuracy/i);
    expect(() => accuracyMetres(Number.NaN)).toThrow(/accuracy/i);
  });

  it('caps a huge reading at 10 km so the server still sees that it is poor', () => {
    expect(accuracyMetres(25000)).toBe(10000);
  });
});
