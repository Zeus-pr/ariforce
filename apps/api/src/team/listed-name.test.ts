import { describe, expect, it } from 'vitest';
import { listedName } from './listed-name';

describe('listed name', () => {
  it('keeps a current person as their name', () => {
    expect(listedName('Mina Das', 'active', 'Active')).toBe('Mina Das');
    expect(listedName('Mina Das', 'active', null)).toBe('Mina Das');
  });

  it('marks someone who has left, is inactive, or is suspended', () => {
    expect(listedName('Hriday Kumar Bari', 'active', 'Left')).toBe('Hriday Kumar Bari (left)');
    expect(listedName('Hriday Kumar Bari', 'active', 'Inactive')).toBe(
      'Hriday Kumar Bari (inactive)',
    );
    expect(listedName('Hriday Kumar Bari', 'active', 'Suspended')).toBe(
      'Hriday Kumar Bari (suspended)',
    );
    expect(listedName('Hriday Kumar Bari', 'suspended', 'Active')).toBe(
      'Hriday Kumar Bari (suspended)',
    );
  });

  it('prefers left when both say they are gone', () => {
    expect(listedName('Hriday Kumar Bari', 'suspended', 'Left')).toBe('Hriday Kumar Bari (left)');
  });
});
