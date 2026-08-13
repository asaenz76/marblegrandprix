import Link from "next/link";
import type { RacingPoolContext } from "@/lib/racing/pool-presentation";
import { humanizeEnum } from "@/lib/utils/humanize";

/**
 * Player-facing racing context header for a pool card (Phase 9). Replaces the
 * football MatchIdentity for RACE_WINNER/COMPETITION_WINNER pools: it names the
 * competition and race, links to the read-only player race/competition pages,
 * and states racing-appropriate status. No fixture/home/away/draw.
 */
export function RacingPoolHeader({ racing }: { racing: RacingPoolContext }) {
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
        {racing.competitionId && racing.competitionName && (
          <Link href={`/competitions/${racing.competitionId}`} className="font-medium text-accent-primary hover:underline">
            {racing.competitionName}
          </Link>
        )}
        {racing.competitionFormat && <span className="text-text-muted">{humanizeEnum(racing.competitionFormat)}</span>}
      </div>
      {racing.scope === "RACE" ? (
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          {racing.raceId ? (
            <Link href={`/races/${racing.raceId}`} className="font-semibold text-text-primary hover:underline">
              {racing.raceTitle ?? "Race"}
            </Link>
          ) : (
            <span className="font-semibold text-text-primary">{racing.raceTitle ?? "Race"}</span>
          )}
          {racing.raceStatus && <span className="text-xs text-text-muted">{humanizeEnum(racing.raceStatus)}</span>}
        </div>
      ) : (
        <div className="text-sm font-semibold text-text-primary">Competition winner</div>
      )}
    </div>
  );
}
