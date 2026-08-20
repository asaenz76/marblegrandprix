import { ClipboardCheck, Timer, Flag, Trophy } from "lucide-react";

const STEPS = [
  { Icon: ClipboardCheck, title: "Practice", when: "Monday–Thursday", body: "Study the field, make your picks and build your streak." },
  { Icon: Timer, title: "Qualifying", when: "Friday–Saturday", body: "The clock decides the grid. Fastest marble takes pole." },
  { Icon: Flag, title: "Grand Prix", when: "Sunday", body: "Lights out. Pick your winner and watch the race unfold." },
  { Icon: Trophy, title: "Classification", when: "After the race", body: "Points are awarded and the championship standings update." },
];

/**
 * How Race Week Works — the four-step weekly loop that replaces the old
 * competition-format explainer. Practice → Qualify → Grand Prix → Championship.
 */
export function HowRaceWeekWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
      <h2 className="text-center font-display text-2xl font-extrabold uppercase tracking-wide sm:text-3xl">How Race Week Works</h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-text-secondary">
        Race all week. Compete on Sunday.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ Icon, title, when, body }, i) => (
          <div key={title} className="rounded-2xl border-2 border-border-subtle bg-surface-primary p-5 shadow-sticker">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-full bg-accent-primary text-white">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="text-xs font-bold uppercase tracking-wide text-text-muted">{String(i + 1).padStart(2, "0")} · {title}</span>
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{when}</p>
            <p className="mt-1 text-sm text-text-secondary">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
