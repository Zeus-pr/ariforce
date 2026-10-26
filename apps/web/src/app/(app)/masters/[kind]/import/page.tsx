import { notFound } from 'next/navigation';
import { isMasterKind, MASTERS } from '@/components/masters/config';
import { ImportWizard } from '@/components/masters/import-wizard';

export function generateStaticParams() {
  return Object.keys(MASTERS).map((kind) => ({ kind }));
}

export const metadata = { title: 'Import' };

export default async function ImportPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isMasterKind(kind)) notFound();
  return <ImportWizard kind={kind} />;
}
