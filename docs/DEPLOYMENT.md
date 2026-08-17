# Deployment

Marble Grand Prix deploys as a standard Next.js app on Vercel, backed by a
hosted Supabase project, with two background jobs driven by an external cron
scheduler and transactional email through Resend. This doc covers what's
specific to this project — for general Vercel/Next.js/Supabase mechanics, see
their own docs.

Everything below is a **founder/operator** task performed against your own
hosted infrastructure. The repository is prepared for these steps; it does not
perform them.

---

## 1. Prerequisites

- A **GitHub** repository containing this codebase (Vercel deploys from it).
- A **Supabase** project (supabase.com) — hosted Postgres + Auth.
- A **Vercel** project linked to the GitHub repo.
- A **Resend** account (resend.com) for transactional email.
- **DNS access** for your sending domain (only needed when you move email to
  `marblegrandprix.com`; see §7).

You do not need a paid Vercel plan for hosting — cron runs via an external
scheduler (§6), so the free (Hobby) plan is sufficient.

---

## 2. Environment variables

Set these in the Vercel project's **Environment Variables** settings. The
canonical list is `.env.example`; every variable below is read by real runtime
or operator code (verified against `process.env` usage).

### Required in production

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Hosted project URL, e.g. `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public, RLS-scoped anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only. Bypasses RLS — never expose to the client, never commit.** |
| `APP_URL` | The deployed app's public URL (e.g. `https://app.marblegrandprix.com`). Used for `metadataBase` and links in emails. |
| `DEFAULT_TIMEZONE` | e.g. `America/Costa_Rica` — the same-calendar-day grace window for anomaly voids/refunds |
| `CRON_SECRET` | Long random string; authenticates the two cron routes (§6). Without it the routes reject every request and pools never lock/settle. |

### Required only for email

| Variable | Notes |
| --- | --- |
| `RESEND_API_KEY` | Enables transactional email (Supabase Auth SMTP relay + app pool-published emails). With it unset, `sendEmail` no-ops silently — fine for local/CI, **not** for production. See §7. |

### Optional — error monitoring (Sentry)

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Runtime DSN. Unset ⇒ the SDK no-ops everywhere (no errors reported). Set it to start receiving errors. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | **Build-time only** — enable source-map upload for readable stack traces. Optional; errors are still captured without them. |

### One-time bootstrap only — do NOT set as deployed runtime vars

| Variable | Notes |
| --- | --- |
| `ALLOW_PROD_BOOTSTRAP` | Set to `1` **only** for the single `create-super-admin` bootstrap invocation (§4). Never add it to the Vercel runtime environment. |
| `EXPECTED_SUPABASE_HOST` | Optional alternative to the `--project-host` flag for that same one-time invocation. |

### Removed / do not set

- `API_FOOTBALL_BASE_URL`, `API_FOOTBALL_KEY`, `API_FOOTBALL_ENABLED` — the
  automated football data provider was removed (Racing Phase 1). These are
  **unused**; do not set them.
- `NODE_ENV`, `NEXT_RUNTIME` — managed by the framework; do not set manually.

---

## 3. Supabase

1. **Create/link the project** and apply this repo's migrations to it:
   ```bash
   pnpm supabase login
   pnpm supabase link --project-ref <your-project-ref>
   pnpm supabase db push
   ```
   `db push` applies every file under `supabase/migrations/` in order. There is
   no `supabase/seed.sql` — production is never seeded (see §9's dev-only note).
2. **Verify migration state** matches the repo:
   ```bash
   pnpm supabase migration list
   ```
   The remote list should include every local migration (through the latest
   `supabase/migrations/*.sql`).
3. **Do not reuse a local/dev Supabase URL or keys for production**, and vice
   versa. The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — keep it only in
   server-side env (Vercel + your own shell for the one-time bootstrap), never
   in client code, the repo, or chat.

---

## 4. First Super Admin (one-time protected bootstrap)

Invite-only registration has no path for the very first user, so the first
Super Admin is created by the `create-super-admin` operator script. This is the
**one** sanctioned exception to the local-only Supabase guard, and it is gated
deliberately:

- Against a **local** Supabase URL it just works (as in development).
- Against a **hosted** Supabase URL it refuses **unless** you pass, in the same
  invocation, **both** `ALLOW_PROD_BOOTSTRAP=1` **and** a `--project-host` that
  **exactly matches** the target host. `ALLOW_PROD_BOOTSTRAP=1` alone will not
  authorize an arbitrary project.
- If a Super Admin **already exists**, it refuses safely — it never creates a
  second, modifies the existing one, or resets credentials. Run it once.

Run it once, from your own shell (not from Vercel), replacing the placeholders:

```bash
ALLOW_PROD_BOOTSTRAP=1 \
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
pnpm create-super-admin \
  --email you@example.com \
  --password 'a-strong-password' \
  --name "Your Name" \
  --project-host <project-ref>.supabase.co
```

The script prints the target host before doing anything and prints a
`PRODUCTION BOOTSTRAP AUTHORIZED` line when the hosted path is taken. It never
prints secrets. After this, promote/manage further admins through the app
(`/admin/users`, Super-Admin only).

> The local-only guard (`assertLocalSupabase`) remains absolute for seeds,
> dev-grading, verification scripts, and the integration test suite — those are
> **not** affected by `ALLOW_PROD_BOOTSTRAP` and still refuse any non-local
> Supabase URL.

---

## 5. Vercel

1. **Import the GitHub repo** as a Vercel project.
2. **Set the environment variables** from §2 (Production scope).
3. **Build command / framework**: defaults are correct (Next.js; `next build`).
   No custom build command is required. Region is set in `vercel.json`
   (`pdx1`); adjust only if you have a reason to.
4. **Cron model**: cron is **not** run by Vercel (see §6) — no Pro plan needed
   for scheduling.
5. Deploy. Confirm the deploy succeeds and the landing/login page loads.

---

## 6. Cron jobs (external scheduler)

Two routes must be hit **once a minute**:

- `GET /api/cron/lock-pools` — locks pools whose `locks_at` has passed and
  auto-cancels/refunds pools below their minimum entries.
- `GET /api/cron/process-results` — settles pools awaiting results and runs the
  idempotent racing settlement/progression safety nets.

Both check `Authorization: Bearer $CRON_SECRET` and return `401` on a mismatch.
The route logic and this authentication are unchanged by this phase.

**Scheduler choice — external (cron-job.org), not Vercel Cron.** Per-minute
native Vercel Cron requires a Vercel plan that permits sub-daily schedules (the
Hobby plan only allows daily). To stay plan-agnostic and avoid an unsafe slower
cadence, use a free external scheduler such as [cron-job.org](https://cron-job.org).
Set `CRON_SECRET` in Vercel first, then create two jobs:

| Job | URL | Method | Schedule | Header |
| --- | --- | --- | --- | --- |
| Lock pools | `<APP_URL>/api/cron/lock-pools` | `GET` | Every 1 minute | `Authorization: Bearer <CRON_SECRET>` |
| Process results | `<APP_URL>/api/cron/process-results` | `GET` | Every 1 minute | `Authorization: Bearer <CRON_SECRET>` |

Use the actual `APP_URL` and `CRON_SECRET` values (never paste `CRON_SECRET`
anywhere outside the Vercel env var and the scheduler's own settings). Every run
is recorded in `background_jobs`; after the first deploy check **/admin/reports →
Job Health** to confirm both jobs are firing, and the scheduler's own history for
delivery failures (a `401` means the secret doesn't match).

> **Alternative (Vercel Cron on a Pro+ plan only).** If your Vercel plan
> supports per-minute schedules, you may instead add a `crons` block to
> `vercel.json` pointing at the two paths above with an `* * * * *` schedule
> (Vercel auto-sends the `Authorization: Bearer $CRON_SECRET` header when
> `CRON_SECRET` is set). This repo intentionally ships **without** that block so
> a Hobby deploy is not rejected — choose exactly one scheduler, not both.

---

## 7. Email (Resend)

The app sends transactional email via [Resend](https://resend.com): Supabase
Auth's password-reset/SMTP relay, and the app's own pool-published notifications
(`lib/email/resend.ts`). With `RESEND_API_KEY` unset, `sendEmail` no-ops.

**Sending identity:**

- **Current (ships today):** `Marble Grand Prix <notifications@brohda.com>` —
  the `brohda.com` domain is the already-verified Resend/SMTP sender. The
  **display name is already "Marble Grand Prix"**; only the underlying domain is
  still `brohda.com`.
- **Target after DNS verification:** `Marble Grand Prix <notifications@marblegrandprix.com>`.
  Switching requires verifying `marblegrandprix.com` in Resend (and updating the
  Supabase Auth SMTP sender), then changing the one `FROM_ADDRESS` constant in
  `lib/email/resend.ts`. Do **not** put an unverified sending domain into
  production code — treat the switch as a deployment checklist item, not a code
  change to make blindly.

**Setup:**

1. Sign up at resend.com (do this yourself).
2. Verify the sending domain in Resend → Domains (add the SPF/DKIM DNS records
   it provides). Keep `brohda.com` verified for the current sender, or verify
   `marblegrandprix.com` for the target sender.
3. Create an API key (Settings → API Keys) and set `RESEND_API_KEY` in Vercel.
4. In the Supabase dashboard → Authentication → Emails → SMTP Settings, enable
   custom SMTP: host `smtp.resend.com`, port `465` (SSL) or `587` (STARTTLS),
   username `resend`, password = the Resend API key, sender = an address on the
   verified domain, sender name `Marble Grand Prix`.
5. Send a test password-reset email and confirm delivery (check spam first
   time). Players can opt out of pool notifications from Edit Profile
   (`email_notifications_enabled`, defaults on).

---

## 8. App URL

`APP_URL` is the canonical public origin of the deployed app. It sets Next's
`metadataBase` (`app/layout.tsx`) and is the origin used to build pool links in
emails. Set it to the exact production URL, e.g. `https://app.marblegrandprix.com`.
The app is `noindex` by design (invite-only) via `app/robots.ts` and the
`robots` metadata.

---

## 9. Deploying later migrations

Any new file under `supabase/migrations/` must be applied to the hosted project
with `pnpm supabase db push` before (or as part of) the deploy that depends on
it — Vercel does not run migrations. Keep schema changes and the code that
depends on them in the same deploy where possible; there is no rollback tooling
beyond writing a new forward migration.

**Seeds are dev/demo only — never production.** `pnpm seed` and
`pnpm seed:dev-grading` create demo accounts with publicly-known passwords and
sample data, and both refuse to run against a non-local Supabase URL (the
`assertLocalSupabase` guard). Never run them against a production database; use a
separate throwaway Supabase project for any staging demo.

---

## 10. Post-deploy smoke test

A concise, in-order launch checklist against the deployed app:

1. **Landing / auth** — landing (or login, if registration is closed) loads.
2. **Login** — sign in as the bootstrapped Super Admin.
3. **Super Admin access** — `Manage` and `Admin` are visible; `/racing` loads.
4. **Organizer assignment** — create/assign an Organizer to a competition
   (`/racing/competitions/[id]` → Organizers).
5. **Competition creation** — create a competition (`/racing/competitions/new`).
6. **Race creation** — add a race with ≥2 competitors.
7. **Pool creation** — create a Race Winner and a Competition Winner pool from
   the race/competition pages.
8. **Player feed** — as a funded player, the public pool appears in the feed.
9. **Player entry** — enter a pool; balance debits, pick is shown.
10. **Result confirmation** — as operator, record + confirm the race result.
11. **Settlement** — the pool settles (or hits review); winners' wallets update.
12. **Wallet update** — the player's ledger reflects the entry and any payout.
13. **Cron health** — `/admin/reports → Job Health` shows both jobs firing.
14. **Email** — trigger a password reset (and, if desired, publish a pool) and
    confirm delivery, once `RESEND_API_KEY` + SMTP are configured.
