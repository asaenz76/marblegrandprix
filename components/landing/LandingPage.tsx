import type { LandingPageData } from "@/lib/landing/fetch";
import { LandingNav } from "./LandingNav";
import { LandingHero } from "./LandingHero";
import { ActivityStrip } from "./ActivityStrip";
import { HowItWorks } from "./HowItWorks";
import { ProductShowcase } from "./ProductShowcase";
import { FormatsSection } from "./FormatsSection";
import { BetaStats } from "./BetaStats";
import { FinalCta } from "./FinalCta";
import { LandingFooter } from "./LandingFooter";

export function LandingPage({ data }: { data: LandingPageData }) {
  return (
    <div className="flex min-h-full flex-col">
      <LandingNav />
      <main className="flex-1">
        <LandingHero heroPool={data.heroPool} />
        <ActivityStrip items={data.activity} />
        <HowItWorks />
        <ProductShowcase feedPools={data.feedPools} leaderboard={data.leaderboard} />
        <FormatsSection />
        <BetaStats stats={data.stats} />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
