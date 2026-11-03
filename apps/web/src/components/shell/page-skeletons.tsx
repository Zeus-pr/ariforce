import { Skeleton } from '@ariforce/ui/components/skeleton';

/** Route-level loading shapes, close to the real layouts so the page doesn't jump on arrival. */
export function ListPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6" aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 35 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}
