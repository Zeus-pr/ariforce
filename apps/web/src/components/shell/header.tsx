import Image from "next/image";
import Link from "next/link";

const NAV = ["Dashboard", "Masters", "Attendance", "DCR", "Tour plans"];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="AriForce home">
          <Image
            src="/brand/ariforce-mark.png"
            alt=""
            width={36}
            height={32}
            priority
            data-af-header-logo
            className="block h-8 w-9"
          />
          <span className="af-page text-[17px] font-semibold tracking-tight text-brand-navy">AriForce</span>
        </Link>
        <nav className="af-page hidden items-center gap-1 text-sm text-zinc-600 md:flex" aria-label="Primary">
          {NAV.map((item, i) => (
            <a
              key={item}
              href="#"
              aria-current={i === 0 ? "page" : undefined}
              className="rounded-md px-3 py-1.5 transition-colors hover:bg-zinc-100 hover:text-zinc-900 aria-[current=page]:bg-zinc-100 aria-[current=page]:text-zinc-900"
            >
              {item}
            </a>
          ))}
        </nav>
        <div className="af-page ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-zinc-500 sm:inline">Arighna Pharmaceutical</span>
          <span className="grid size-8 place-items-center rounded-full bg-brand-navy text-xs font-medium text-white">
            PC
          </span>
        </div>
      </div>
    </header>
  );
}
