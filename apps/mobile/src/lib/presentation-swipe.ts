/** Next slide after a swipe. 1 moves forward, -1 moves back. Stays inside the deck. */
export function nextSlide(page: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, page + direction));
}

/**
 * 1 = next, -1 = previous, 0 = ignore.
 * `along` is the finger travel on the slide’s horizontal axis (screen X, or screen Y when the
 * slide is turned 90°). A mostly-vertical drag is not a page change.
 */
export function swipeDirection(along: number, across: number, min = 36): 1 | -1 | 0 {
  if (Math.abs(along) < min || Math.abs(along) <= Math.abs(across)) return 0;
  return along < 0 ? 1 : -1;
}
