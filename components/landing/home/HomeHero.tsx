import Link from "next/link";
import { Flag } from "lucide-react";
import type { HomeRound } from "@/lib/landing/fetch";
import { LocalDateTime } from "@/components/LocalDateTime";
import { Countdown } from "./Countdown";

/**
 * Hero — the next official Grand Prix owns the top of the page. Round, circuit
 * (race title), date/time, status, a live countdown, and a state-aware primary
 * CTA. On the logged-out homepage every CTA funnels to sign-up; the label still
 * reflects the race-week state so the intent is clear.
 */
export function HomeHero({
  championship,
  nextGrandPrix,
}: {
  championship: { name: string } | null;
  nextGrandPrix: HomeRound | null;
}) {
  if (!championship || !nextGrandPrix) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-primary-label">
          Marble Racing Championship
        </p>
        <h1 className="mt-3 max-w-3xl text-balance font-display text-4xl font-extrabold sm:text-5xl">
          Race all week. Compete on Sunday.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-text-secondary">
          Practice Races Monday–Thursday. Qualifying sets the grid. Sunday&apos;s Grand Prix is the official
          championship event. The next round is being scheduled now.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/register" className="inline-flex h-11 items-center rounded-lg border-2 border-border-subtle bg-primary px-5 font-semibold text-primary-foreground shadow-sticker-sm">
            Join the Beta
          </Link>
          <Link href="#how-it-works" className="inline-flex h-11 items-center rounded-lg border-2 border-border-subtle bg-surface-primary px-5 font-semibold text-text-primary shadow-sticker-sm">
            How Race Week Works
          </Link>
        </div>
      </section>
    );
  }

  const start = nextGrandPrix.scheduledStartUtc;

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="rounded-2xl border-2 border-border-subtle bg-surface-primary p-6 shadow-sticker sm:p-10">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-2.5 py-1 text-white">
            <Flag className="size-3.5" aria-hidden="true" /> Round {String(nextGrandPrix.roundNumber ?? 1).padStart(2, "0")}
          </span>
          <span className="text-text-muted">· {championship.name}</span>
        </div>

        <h1 className="mt-4 text-balance font-display text-4xl font-extrabold sm:text-6xl">
          {nextGrandPrix.title}
          <span className="text-accent-primary"> Grand Prix</span>
        </h1>

        {start && (
          <p className="mt-3 text-lg text-text-secondary">
            <LocalDateTime
              iso={start}
              options={{ weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }}
            />
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          {start && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Lights out in</p>
              <Countdown targetIso={start} />
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Link href="/register" className="inline-flex h-11 items-center rounded-lg border-2 border-border-subtle bg-primary px-5 font-semibold uppercase tracking-wide text-primary-foreground shadow-sticker-sm">
              Enter Grand Prix
            </Link>
            <Link href="#standings" className="inline-flex h-11 items-center rounded-lg border-2 border-border-subtle bg-surface-primary px-5 font-semibold uppercase tracking-wide text-text-primary shadow-sticker-sm">
              View standings
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
