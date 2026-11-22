import { Skeleton } from '@ariforce/ui/components/skeleton';

/** Route-level loading shapes, close to the real layouts so the page doesn't jump on arrival. */
export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

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

export function DeskPageSkeleton({ embedded = false }: { embedded?: boolean }) {
  return (
    <div
      className={
        embedded ? 'flex flex-col gap-4' : 'mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6'
      }
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function WorkPageSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Skeleton className="h-80" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
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
