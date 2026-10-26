import type { Metadata, Viewport } from "next";
import { Splash } from "@/components/splash/splash";
import { splashBootScript } from "@/components/splash/splash-script";
import { Header } from "@/components/shell/header";
import { googleSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AriForce", template: "%s · AriForce" },
  description: "Field force management for Arighna Pharmaceutical.",
  applicationName: "AriForce",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={googleSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: splashBootScript }} />
      </head>
      <body className="min-h-dvh bg-zinc-50 font-sans text-zinc-900">
        <Header />
        <main className="af-page">{children}</main>
        <Splash />
      </body>
    </html>
  );
}
