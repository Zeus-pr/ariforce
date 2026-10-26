import type { Metadata, Viewport } from 'next';
import { Toaster } from '@ariforce/ui/components/sonner';
import { TooltipProvider } from '@ariforce/ui/components/tooltip';
import { Providers } from '@/components/shell/providers';
import { Splash } from '@/components/splash/splash';
import { authBootScript } from '@/lib/auth-boot';
import { splashBootScript } from '@/components/splash/splash-script';
import { googleSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AriForce', template: '%s · AriForce' },
  description: 'Field force management for Arighna Pharmaceutical.',
  applicationName: 'AriForce',
};

export const viewport: Viewport = { themeColor: '#ffffff', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={googleSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: authBootScript }} />
        <script dangerouslySetInnerHTML={{ __html: splashBootScript }} />
      </head>
      <body className="min-h-dvh">
        <Providers>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
          <Splash />
        </Providers>
      </body>
    </html>
  );
}
