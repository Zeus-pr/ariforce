import { TeamDcrDetail } from '@/components/dcr/team-dcr-detail';

export const metadata = { title: 'DCR' };

export default async function DcrReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <TeamDcrDetail id={id} />
    </div>
  );
}
