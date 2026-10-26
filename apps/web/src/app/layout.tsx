import type { Metadata } from 'next';
import { MockProvider } from '@/lib/mock-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'AriForce',
  description: 'Pharma field-force automation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <MockProvider>{children}</MockProvider>
      </body>
    </html>
  );
}
