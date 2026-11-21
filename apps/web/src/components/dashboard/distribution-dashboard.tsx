'use client';

import { PlaceDesk } from '@/components/performance/place-desk';
import type { Role } from '@/lib/roles';

export function DistributionDashboard({
  role: _role,
  month: _month,
}: {
  role: Role;
  month: string;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <PlaceDesk title="Distribution" />
    </div>
  );
}
