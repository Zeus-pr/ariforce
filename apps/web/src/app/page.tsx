import { Button } from '@ariforce/ui/components/button';

// Placeholder only. Splash (#2) and design system (#3) are owned by AriForce Dev.
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">AriForce</h1>
      <p className="text-muted-foreground text-sm">Scaffold placeholder</p>
      <Button variant="outline">Coming soon</Button>
    </main>
  );
}
