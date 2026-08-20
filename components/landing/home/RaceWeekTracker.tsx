"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, Timer, Flag, Trophy, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = [
  { key: "practice", label: "Practice", sub: "Mon–Thu", Icon: ClipboardCheck },
  { key: "qualifying", label: "Qualifying", sub: "Fri–Sat", Icon: Timer },
  { key: "raceday", label: "Race Day", sub: "Sunday", Icon: Flag },
  { key: "classification", label: "Classification", sub: "After the race", Icon: Trophy },
] as const;

// Which stage the week is in, by day (client-side so it uses the visitor's
// timezone). Mon–Thu → Practice, Fri/Sat → Qualifying, Sun → Grand Prix.
// Result lights up only once we can confirm a race has run (deferred), so the
// day heuristic never forces it active.
function activeStageForDay(day: number): number {
  if (day >= 1 && day <= 4) return 0;
  if (day === 5 || day === 6) return 1;
  return 2; // Sunday
}

export function RaceWeekTracker() {
  const [active, setActive] = useState<number | null>(null);
  // Mount-gate: the active stage depends on the visitor's local day, which is
  // only known client-side. Setting it once on mount is the intended pattern
  // here (server renders no active stage), so the set-state-in-effect lint is
  // deliberately suppressed rather than worked around.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(activeStageForDay(new Date().getDay()));
  }, []);

  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-muted">Race Week</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        {STAGES.map((stage, i) => {
          const isActive = active === i;
          const isDone = active != null && i < active;
          return (
            <div key={stage.key} className="flex flex-1 items-center gap-3 sm:flex-col sm:items-stretch">
              <div
                className={cn(
                  "flex flex-1 items-center gap-3 rounded-xl border-2 p-4 transition-colors",
                  isActive
                    ? "border-border-subtle bg-accent-primary text-white shadow-sticker-sm"
                    : isDone
                      ? "border-border-subtle bg-surface-secondary text-text-secondary"
                      : "border-border-subtle bg-surface-primary text-text-primary shadow-sticker-sm",
                )}
              >
                <stage.Icon className="size-5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold uppercase tracking-wide leading-tight">{stage.label}</p>
                  <p className={cn("text-xs uppercase tracking-wide", isActive ? "text-white/80" : "text-text-muted")}>{stage.sub}</p>
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <ChevronRight className="hidden size-5 shrink-0 self-center text-text-muted sm:block" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
