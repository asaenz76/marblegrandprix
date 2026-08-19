import { ClipboardCheck, Flag, Trophy } from "lucide-react";

const STEPS = [
  {
    icon: ClipboardCheck,
    title: "Pick",
    description: "Choose a competitor before the race locks, and enter the pool.",
  },
  {
    icon: Flag,
    title: "Race",
    description: "Watch the race run and the field finish alongside everyone else's picks.",
  },
  {
    icon: Trophy,
    title: "Result",
    description: "The confirmed result settles every winning pool entry automatically.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="text-center font-display text-2xl font-extrabold text-text-primary sm:text-3xl">
        How it works
      </h2>
      <p className="mt-2 text-center text-text-secondary">Three steps, from your pick to the result.</p>
      <div className="mt-10 grid gap-8 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, description }, i) => (
          <div key={title} className="space-y-3 text-center sm:text-left">
            <div className="flex items-center justify-center gap-2.5 sm:justify-start">
              <span className="flex size-9 items-center justify-center rounded-full bg-black text-sm font-semibold text-[#ffe100]">
                {i + 1}
              </span>
              <Icon className="size-5 text-text-primary" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
            <p className="text-sm text-text-secondary">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
