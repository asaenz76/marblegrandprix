import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Rules — Marble Grand Prix",
};

export default async function RulesPage() {
  await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">How pools work</h1>
        <p className="mt-1 text-sm text-text-muted">
          The rules every pool follows — worth a read before you join one.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-8 pt-6 text-sm leading-relaxed text-text-secondary [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text-primary [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p+p]:mt-3 [&_strong]:font-semibold [&_strong]:text-text-primary [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          <section>
            <h2>What a pool is</h2>
            <p>
              A pool is a simple prediction: a question with two or more options. Everyone who wants
              in picks one competitor and puts money on it. Once the pool locks, no more entries are
              accepted, and once the result is confirmed, whoever called it right splits the prize.
            </p>
          </section>

          <section>
            <h2>Types of pools</h2>
            <ul>
              <li>
                <strong>Race Winner</strong> — pick the competitor you think wins a single race.
                It settles automatically once an organizer confirms the race result.
              </li>
              <li>
                <strong>Competition Winner</strong> — pick who you think wins a whole competition,
                whether that&apos;s a Championship, League, Bracket, or Elimination. It settles once
                the competition is finalized and the champion is set.
              </li>
            </ul>
          </section>

          <section>
            <h2>Joining a pool</h2>
            <ul>
              <li>
                Pick one competitor to join — the pool&apos;s entry fee, set by whoever created it,
                is deducted from your wallet balance the moment you submit your pick.
              </li>
              <li>
                Entries are final. Once submitted, you can&apos;t change or cancel your own pick —
                only an admin can void an entry, and only to fix a genuine mistake.
              </li>
              <li>
                Entries close the moment the pool locks — before the race starts, or the time set
                for a Competition Winner pool. Nothing is accepted after that.
              </li>
            </ul>
          </section>

          <section>
            <h2>How payouts work</h2>
            <ul>
              <li>
                Every pool discloses its service fee upfront — a flat percentage held back from the
                total pot before anything is paid out.
              </li>
              <li>
                What&apos;s left is split evenly across everyone who picked the winning competitor,
                no matter when they entered.
              </li>
              <li>
                If the pot doesn&apos;t divide evenly, the leftover cents stay with the house rather
                than being redistributed.
              </li>
            </ul>
          </section>

          <section>
            <h2>When a pool is voided and refunded</h2>
            <p>Your full stake is returned (no fee) when:</p>
            <ul>
              <li>
                The race is postponed, cancelled, or can&apos;t be resolved to a single winner — for
                example, a tie at the front — and isn&apos;t settled by the end of that same day.
              </li>
              <li>The pool doesn&apos;t reach its minimum number of entries.</li>
              <li>Nobody picked the winning competitor.</li>
              <li>Everybody picked the winning competitor.</li>
              <li>An admin cancels the pool manually to correct a mistake.</li>
            </ul>
          </section>

          <section>
            <h2>Wallet, deposits, and withdrawals</h2>
            <p>
              Your wallet balance is a running record, not money actually held by the app. Every
              deposit and withdrawal happens off-platform, using whatever method is made available
              by the platform admin (bank transfer, mobile payment, cash, etc.).
            </p>
            <p>
              To add or remove funds, submit a request from your wallet page describing what you
              sent or want to receive. An admin reviews it, and your balance only updates once they
              confirm the transfer happened.
            </p>
          </section>

          <section>
            <h2>Fair play</h2>
            <ul>
              <li>Don&apos;t try to manipulate the outcome of a pool.</li>
              <li>Don&apos;t use more than one account.</li>
              <li>
                Admins may correct records, cancel pools, or void individual entries to keep the
                group&apos;s ledger accurate — their good-faith decisions on the app&apos;s records
                are final.
              </li>
            </ul>
            <p>
              Full legal terms live in the{" "}
              <Link href="/terms" className="underline underline-offset-4">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
