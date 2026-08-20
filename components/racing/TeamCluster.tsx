import { cn } from "@/lib/utils";
import { CompetitorIdentity, cssColor, type CompetitorIdentityData } from "./CompetitorIdentity";

export type TeamIdentityData = {
  name: string;
  color?: string | null;
  imageUrl?: string | null;
  members: CompetitorIdentityData[];
};

/**
 * A team ("constructor") shown as its name/logo plus its member marbles
 * clustered together — the "name + member marbles clustered" identity used in
 * the team library, the constructors' standings, and the race-create preview.
 * Composition of CompetitorIdentity (a marble); it represents a TEAM, so it is
 * a sibling of CompetitorIdentity rather than a variant of it.
 */
export function TeamCluster({
  team,
  size = "md",
  className,
}: {
  team: TeamIdentityData;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="inline-flex items-center gap-1.5">
        {team.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.imageUrl} alt="" className={cn("rounded-full object-cover", size === "sm" ? "h-5 w-5" : "h-6 w-6")} />
        ) : team.color ? (
          <span
            className={cn("rounded-full", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")}
            style={{ backgroundColor: cssColor(team.color), boxShadow: "0 0 0 1.5px var(--competitor-ring)" }}
          />
        ) : null}
        <span className={cn("font-semibold", size === "sm" ? "text-xs" : "text-sm")}>{team.name}</span>
      </span>
      {team.members.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {team.members.map((m, i) => (
            <CompetitorIdentity key={i} competitor={m} size="sm" />
          ))}
        </span>
      )}
    </span>
  );
}
