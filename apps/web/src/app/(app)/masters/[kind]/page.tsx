import { notFound } from 'next/navigation';
import { isMasterKind, MASTERS } from '@/components/masters/config';
import { MastersTabs, MastersView } from '@/components/masters/masters-view';

export function generateStaticParams() {
  return Object.keys(MASTERS).map((kind) => ({ kind }));
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: isMasterKind(kind) ? MASTERS[kind].title : 'Masters' };
}

export default async function MasterPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isMasterKind(kind)) notFound();
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Masters</h1>
        <MastersTabs kind={kind} />
      </div>
      <MastersView kind={kind} />
    </div>
  );
}
