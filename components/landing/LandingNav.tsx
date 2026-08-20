import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InstallAppButton } from "@/components/InstallAppButton";
import { Wordmark } from "@/components/Wordmark";

// Deliberately just logo + how-it-works anchor + the two auth CTAs — no
// "Community"/"About" links, since those pages don't exist yet and a
// marketing nav shouldn't point at pages we haven't built.
export function LandingNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-border-subtle bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Wordmark variant="responsive" size="lg" />
        <nav className="hidden items-center gap-6 text-sm font-bold text-text-primary sm:flex">
          <a href="#schedule" className="hover:text-accent-primary">Championship</a>
          <a href="#schedule" className="hover:text-accent-primary">Schedule</a>
          <a href="#standings" className="hover:text-accent-primary">Standings</a>
          <a href="#how-it-works" className="hover:text-accent-primary">How it works</a>
        </nav>
        <div className="flex items-center gap-2">
          <InstallAppButton />
          <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "font-bold")}>
            Sign In
          </Link>
          <Link href="/register" className={cn(buttonVariants({ size: "sm" }), "font-bold")}>
            Join the Beta
          </Link>
        </div>
      </div>
    </header>
  );
}
