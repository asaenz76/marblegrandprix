import { ClipboardCheck, Timer, Flag, Trophy } from "lucide-react";

const STEPS = [
  { Icon: ClipboardCheck, title: "Practice", body: "Make your picks Monday–Thursday and learn the field." },
  { Icon: Timer, title: "Qualify", body: "The official session sets Sunday's starting grid." },
  { Icon: Flag, title: "Grand Prix", body: "Enter the Sunday race and make your call." },
  { Icon: Trophy, title: "Championship", body: "Official race points update the season standings." },
];

/**
 * How Race Week Works — the four-step weekly loop that replaces the old
 * competition-format explainer. Practice → Qualify → Grand Prix → Championship.
 */
export function HowRaceWeekWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
      <h2 className="text-center font-display text-2xl font-extrabold sm:text-3xl">How race week works</h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-text-secondary">
        Race all week. Compete on Sunday.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ Icon, title, body }, i) => (
          <div key={title} className="rounded-2xl border-2 border-border-subtle bg-surface-primary p-5 shadow-sticker">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-full bg-accent-primary text-white">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="text-xs font-bold uppercase tracking-wide text-text-muted">Step {i + 1}</span>
            </div>
            <h3 className="mt-3 font-semibold text-text-primary">{title}</h3>
            <p className="mt-1 text-sm text-text-secondary">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
