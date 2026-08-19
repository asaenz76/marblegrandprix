import { Flag, Trophy, ListOrdered, Network, Filter } from "lucide-react";

// Explains only the competition formats a new player needs to picture the
// racing world — not every internal rule. Human-readable labels, never raw
// enums (SINGLE_RACE/CHAMPIONSHIP/…).
const FORMATS = [
  {
    icon: Flag,
    name: "Single Race",
    description: "One race, one winner — the simplest way to make a call.",
  },
  {
    icon: Trophy,
    name: "Championship",
    description: "Points across a series of races crown an overall champion.",
  },
  {
    icon: ListOrdered,
    name: "League",
    description: "A points table that builds race by race across a season.",
  },
  {
    icon: Network,
    name: "Bracket",
    description: "Winners advance round by round until one is left standing.",
  },
  {
    icon: Filter,
    name: "Elimination",
    description: "Finishing position decides who moves on and who drops out.",
  },
];

export function FormatsSection() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <h2 className="text-center font-display text-2xl font-extrabold text-text-primary sm:text-3xl">
        Every kind of race
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-text-secondary">
        From a one-off sprint to a full championship, competitions run in the formats that make
        racing worth predicting.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map(({ icon: Icon, name, description }) => (
          <div
            key={name}
            // Black card (local dark scope) with a yellow title and a solid
            // yellow icon badge — the bold black-and-yellow race-type look.
            className="dark rounded-2xl border border-border-subtle bg-black p-5"
          >
            <div className="flex size-9 items-center justify-center rounded-full bg-[#ffe100] text-black">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <h3 className="mt-3 font-semibold text-[#ffe100]">{name}</h3>
            <p className="mt-1 text-sm text-text-secondary">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
