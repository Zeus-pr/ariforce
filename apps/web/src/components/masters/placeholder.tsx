/**
 * 'No Doc' rows: placeholder doctors from the source sheet (calls logged at a chemist with no doctor).
 * Shown quietly with a muted tag. Hiding them by default needs a server filter (CONTRACT-GAPS #22):
 * the list is paged on the server, so the browser must not drop rows itself.
 */
export const isPlaceholderName = (name: string) => /^\s*no\s*\.?\s*doc(tor)?\b/i.test(name);

export function PlaceholderTag({ name }: { name: string }) {
  if (!isPlaceholderName(name)) return null;
  return (
    <span
      className="ml-2 rounded border px-1.5 py-px text-[11px] font-normal text-muted-foreground"
      data-testid="placeholder-tag"
    >
      Placeholder
    </span>
  );
}
