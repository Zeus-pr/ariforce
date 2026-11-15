import { OrganizationScreen } from '@/components/admin/organization-screen';

export const metadata = { title: 'Organization' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The company map. Country, state, then an RBM HQ, an ABM HQ, a BM HQ, and the territories
          under that.
        </p>
      </div>
      <OrganizationScreen />
    </div>
  );
}
