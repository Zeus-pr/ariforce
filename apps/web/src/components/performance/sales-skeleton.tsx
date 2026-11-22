import { Skeleton } from '@ariforce/ui/components/skeleton';

function ChartCardSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="flex items-end gap-3" style={{ height: tall ? 280 : 200 }}>
        <Skeleton className="h-2/3 w-8" />
        <Skeleton className="h-1/2 w-8 bg-cyan-200" />
        <Skeleton className="h-4/5 w-8" />
        <Skeleton className="h-2/5 w-8 bg-cyan-200" />
        <Skeleton className="h-3/5 w-8" />
        <Skeleton className="h-1/3 w-8 bg-cyan-200" />
      </div>
    </div>
  );
}

export function SalesChartsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading sales">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
      <ChartCardSkeleton tall />
      <ChartCardSkeleton tall />
    </div>
  );
}

export function SalesSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading sales">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-36 rounded-lg" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-10 w-80 rounded-full" />
      </div>
      <SalesChartsSkeleton />
    </div>
  );
}
