import { notFound } from 'next/navigation';
import { Badge } from '@ariforce/ui/components/badge';
import { DotPattern } from '@ariforce/ui/components/dot-pattern';
import { NAV } from '@/lib/nav';

export function generateStaticParams() {
  return NAV.filter((n) => n.slug && n.slug !== 'masters').map((n) => ({ section: n.slug }));
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
      <div className="relative mt-6 grid min-h-72 place-items-center overflow-hidden rounded-xl border border-dashed bg-card p-8 text-center">
        <DotPattern className="text-border [mask-image:radial-gradient(320px_circle_at_center,white,transparent)]" />
        <div className="relative max-w-md">
          <item.icon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-medium">Not built yet</p>
          <p className="mt-1 text-sm text-muted-foreground">{item.blurb}</p>
          {item.issue && (
            <Badge variant="secondary" className="mt-4">
              Arrives with issue #{item.issue}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
