"use client";

import { useEffect, useState } from "react";

/**
 * Live countdown to a race instant. Renders nothing until mounted (avoids a
 * hydration mismatch on the ticking value); the surrounding hero always also
 * shows the absolute date, so there's no information loss pre-mount.
 */
export function Countdown({ targetIso }: { targetIso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) return <span className="inline-block h-9" aria-hidden="true" />;
  const diff = new Date(targetIso).getTime() - now;
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) {
    return <span className="text-lg font-extrabold uppercase text-accent-primary">Lights out</span>;
  }

  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  const parts: Array<[number, string]> = d > 0 ? [[d, "days"], [h, "hrs"], [m, "min"]] : [[h, "hrs"], [m, "min"], [s, "sec"]];

  return (
    <span className="inline-flex items-end gap-3 tabular-nums">
      {parts.map(([v, l]) => (
        <span key={l} className="inline-flex flex-col items-center leading-none">
          <span className="text-2xl font-extrabold">{String(v).padStart(2, "0")}</span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{l}</span>
        </span>
      ))}
    </span>
  );
}
