import Link from "next/link";
import { Users2, ShieldCheck, Trophy } from "lucide-react";
import type { SocialPoolCardViewModel } from "@/lib/pools/view-model";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PoolPreviewCard } from "./PoolPreviewCard";
import { PhoneFrame } from "./PhoneFrame";

const BULLETS = [
  { icon: Users2, label: "Compete with people, not against the house" },
  { icon: ShieldCheck, label: "Real races and competitions" },
  { icon: Trophy, label: "Community-created pools" },
];

export function LandingHero({ heroPool }: { heroPool: SocialPoolCardViewModel | null }) {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:items-center lg:py-24">
      <div className="space-y-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-primary-subtle px-3 py-1 text-xs font-semibold text-accent-primary">
          <span className="size-1.5 rounded-full bg-accent-primary" aria-hidden="true" />
          Beta now open
        </span>
        <h1 className="text-balance font-display text-4xl font-extrabold tracking-tight text-text-primary sm:text-5xl">
          Call the race. <span className="text-accent-primary">Beat the grid.</span>
        </h1>
        <p className="max-w-md text-lg text-text-secondary">
          Pick a competitor before the gate drops and enter community pools — then watch the race
          decide who called it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "px-6")}>
            Join the beta
          </Link>
          <a
            href="#how-it-works"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-6")}
          >
            See how it works
          </a>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-text-secondary sm:flex-row sm:flex-wrap sm:gap-x-5">
          {BULLETS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-1.5">
              <Icon className="size-4 text-accent-primary" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>

      {heroPool && (
        <div className="mx-auto w-full max-w-sm lg:mx-0 lg:ml-auto">
          <PoolPreviewCard viewModel={heroPool} />
        </div>
      )}
      {!heroPool && (
        <div className="hidden lg:block">
          <PhoneFrame>
            <div className="flex h-64 items-center justify-center text-sm text-text-muted">
              New pools open soon.
            </div>
          </PhoneFrame>
        </div>
      )}
    </section>
  );
}
