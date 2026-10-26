import { notFound } from 'next/navigation';
import { NAV } from '@/lib/nav';

export function generateStaticParams() {
  return NAV.filter((n) => n.slug && !['masters', 'attendance'].includes(n.slug)).map((n) => ({
    section: n.slug,
  }));
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return { title: NAV.find((n) => n.slug === section)?.title ?? 'Not found' };
}

export default async function SectionPlaceholder({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = NAV.find((n) => n.slug === section);
  if (!item) notFound();
  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{item.title}</h1>
      <div className="mt-6 max-w-xl border-l-2 border-border pl-4">
        <p className="text-sm font-medium">Not built yet</p>
        <p className="mt-1 text-sm text-muted-foreground">{item.blurb}</p>
        {item.issue && <p className="mt-2 text-xs text-muted-foreground">Tracked in issue #{item.issue}.</p>}
      </div>
    </div>
  );
}
