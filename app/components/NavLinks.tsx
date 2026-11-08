"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/check", label: "Check" },
  { href: "/shelf", label: "Shelf" },
  { href: "/rebuys", label: "Rebuys" },
  { href: "/payments", label: "Saved methods" },
  { href: "/studio", label: "Decisions", wide: true },
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
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={"wide" in l ? "wide-only" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
