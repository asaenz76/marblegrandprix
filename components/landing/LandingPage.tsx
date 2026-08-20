import type { HomepageData } from "@/lib/landing/fetch";
import { LandingNav } from "./LandingNav";
import { LandingFooter } from "./LandingFooter";
import { HomeHero } from "./home/HomeHero";
import { RaceWeekTracker } from "./home/RaceWeekTracker";
import { PracticeRaceCard } from "./home/PracticeRaceCard";
import { ChampionshipStandings } from "./home/ChampionshipStandings";
import { UpcomingGrandPrix } from "./home/UpcomingGrandPrix";
import { MeetTheGrid } from "./home/MeetTheGrid";
import { GrandPrixEntry } from "./home/GrandPrixEntry";
import { HowRaceWeekWorks } from "./home/HowRaceWeekWorks";
import { LatestResult } from "./home/LatestResult";
import { PlayerLeaderboard } from "./home/PlayerLeaderboard";

/**
 * Public homepage (v2) — a recurring motorsport competition, not a menu of game
 * formats. Modules follow the spec hierarchy: the next official Grand Prix owns
 * the top; the free weekday Practice Race drives daily return; standings, the
 * schedule, and the grid build attachment to the championship; the paid Grand
 * Prix entry stays tied to the featured event.
 */
export function LandingPage({ data }: { data: HomepageData }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />
      <main className="space-y-14 pb-20">
        <HomeHero championship={data.championship} nextGrandPrix={data.nextGrandPrix} />
        <RaceWeekTracker />
        <PracticeRaceCard pool={data.practiceRace} />
        <GrandPrixEntry pool={data.grandPrixPool} grandPrix={data.nextGrandPrix} />
        <ChampionshipStandings rows={data.standings} />
        <MeetTheGrid grid={data.grid} />
        <UpcomingGrandPrix rounds={data.upcomingRounds} />
        <HowRaceWeekWorks />
        <LatestResult result={data.latestResult} />
        <PlayerLeaderboard entries={data.leaderboard} />
      </main>
      <LandingFooter />
    </div>
  );
}
