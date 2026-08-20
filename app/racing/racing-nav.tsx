"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Racing operator sub-navigation (Phase 10). Gives the operator the browse tabs
 * that were previously missing (Competitions was unreachable except by drilling
 * from a race). Active tab is highlighted so location is always clear.
 */
const TABS = [
  { href: "/racing", label: "Home", exact: true },
  { href: "/racing/competitions", label: "Competitions" },
  { href: "/racing/races", label: "Races" },
  { href: "/racing/competitors", label: "Competitors" },
];

export function RacingNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Racing" className="flex gap-1 border-b border-border-subtle">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              active ? "border-accent-primary text-text-primary" : "border-transparent text-text-secondary hover:border-border-strong",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
