import { ClaimView } from '@/components/expenses/claim-view';

export const metadata = { title: 'Expense claim' };

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <ClaimView id={id} />
    </div>
  );
}
