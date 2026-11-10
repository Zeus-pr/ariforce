/// <reference types="jest" />
import { nextSlide, swipeDirection } from '@/lib/presentation-swipe';

describe('presentation swipe', () => {
  it('moves one slide and stops at the ends', () => {
    expect(nextSlide(0, 3, 1)).toBe(1);
    expect(nextSlide(1, 3, -1)).toBe(0);
    expect(nextSlide(0, 3, -1)).toBe(0);
    expect(nextSlide(2, 3, 1)).toBe(2);
    expect(nextSlide(0, 0, 1)).toBe(0);
  });

  it('treats a leftward swipe as next and a rightward swipe as previous', () => {
    expect(swipeDirection(-80, 4)).toBe(1);
    expect(swipeDirection(80, 4)).toBe(-1);
  });

  it('ignores a short drag and a mostly vertical drag', () => {
    expect(swipeDirection(-10, 0)).toBe(0);
    expect(swipeDirection(-20, 40)).toBe(0);
    expect(swipeDirection(0, 80)).toBe(0);
  });
});
