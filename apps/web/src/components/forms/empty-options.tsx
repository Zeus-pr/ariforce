/** Shown inside a SelectContent when the list is empty, so an open dropdown never looks dead. */
export function EmptyOptions({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div role="note" className="px-3 py-2.5 text-sm text-muted-foreground" data-testid={testId ?? 'select-empty'}>
      {children}
    </div>
  );
}
