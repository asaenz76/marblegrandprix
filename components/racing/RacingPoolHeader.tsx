import Link from "next/link";
import type { RacingPoolContext } from "@/lib/racing/pool-presentation";
import { humanizeEnum } from "@/lib/utils/humanize";

/**
 * Player-facing racing context line for a pool card (Phase 9, unified in
 * Phase 12). The competition name is the card's identity in the header above
 * this (PoolLeagueHeader's overrideLabel), so this block carries the detail
 * that differs by scope — the specific race for a RACE_WINNER pool, or the
 * overall-winner framing for a COMPETITION_WINNER pool — plus the format. Both
 * scopes render the same shape so a Race Winner and a Competition Winner card
 * read as one product family. No fixture/home/away/draw.
 */
export function RacingPoolHeader({ racing }: { racing: RacingPoolContext }) {
  // Rounded icon (Phase 16): the race's own image, shown next to the race
  // title. The competition icon lives on the card's top line (PoolLeagueHeader)
  // for every racing pool, so it isn't repeated here — a COMPETITION pool's
  // identity is entirely the top line.
  const iconUrl = racing.scope === "RACE" ? racing.raceImageUrl : null;
  return (
    <div className="flex items-center gap-2">
      {iconUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
      )}
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
        {racing.scope === "RACE" ? (
          <>
            {racing.raceId ? (
              <Link
                href={`/races/${racing.raceId}`}
                className="font-semibold text-text-primary hover:underline"
              >
                {racing.raceTitle ?? "Race"}
              </Link>
            ) : (
              <span className="font-semibold text-text-primary">{racing.raceTitle ?? "Race"}</span>
            )}
            {racing.raceStatus && (
              <span className="text-xs text-text-muted">{humanizeEnum(racing.raceStatus)}</span>
            )}
          </>
        ) : racing.competitionId ? (
          <Link
            href={`/competitions/${racing.competitionId}`}
            className="font-semibold text-accent-primary hover:underline"
          >
            Overall winner
          </Link>
        ) : (
          <span className="font-semibold text-text-primary">Overall winner</span>
        )}
      </div>
        {racing.competitionFormat && (
          <div className="text-xs text-text-muted">{humanizeEnum(racing.competitionFormat)}</div>
        )}
      </div>
    </div>
  );
}
