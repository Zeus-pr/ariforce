/* Pure helper shared by the importers (no Nest imports: scripts load it with tsx). */
/**
 * Materialised path of a new territory, following the parent's convention: real data uses code
 * segments (WB.HQ_MALDA), the seed and older imports use ids. Code segment = the code with every
 * non-alphanumeric as '_' (HQ-MALDA -> HQ_MALDA). Falls back to the id when the parent is id-based,
 * the code segment would be empty, or the path is already taken. Roots use the id.
 */
export function childPath(
  parentId: string | null | undefined,
  parentPath: string | null | undefined,
  code: string,
  id: string,
  taken: Set<string>,
): string {
  if (!parentId || !parentPath) return id;
  const parentSeg = parentPath.slice(parentPath.lastIndexOf('.') + 1);
  const seg = code.trim().replace(/[^A-Za-z0-9]/g, '_');
  const byCode = `${parentPath}.${seg}`;
  if (parentSeg !== parentId && seg && !taken.has(byCode)) return byCode;
  return `${parentPath}.${id}`;
}
