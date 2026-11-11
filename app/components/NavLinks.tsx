"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The app's pages, the week first. `short` is the label on a phone's bottom bar, where six must fit. */
const LINKS: Array<{ href: string; label: string; short?: string }> = [
  { href: "/week", label: "This week", short: "Week" },
  { href: "/check", label: "Check" },
  { href: "/shelf", label: "Shelf" },
  { href: "/rebuys", label: "Reorders" },
  { href: "/payments", label: "Payments" },
  { href: "/studio", label: "Dashboard" },
];

export function NavLinks(props: { static?: boolean }) {
  return props.static ? <Links path={null} /> : <ActiveLinks />;
}

function ActiveLinks() {
  return <Links path={usePathname()} />;
}

function Links({ path }: { path: string | null }) {
  return (
    <nav className="mainnav" aria-label="Main">
      {LINKS.map((l) => {
        const active = path !== null && (path === l.href || path.startsWith(`${l.href}/`));
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
            {l.short ? (
              <>
                <span className="nav-long">{l.label}</span>
                <span className="nav-short">{l.short}</span>
              </>
            ) : (
              l.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
