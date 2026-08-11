# Racing Implementation Plan

**Project location:** `/Users/Shared/racing-project`
**Baseline:** `brohda-rc1` @ `595702c` (verified clone, remotes detached)
**Status:** Planning only. No application code, migrations, or config changed. Awaiting approval before Phase 1.
**Companion doc:** `RACING_CLONE_ARCHITECTURE_REPORT.md` (architectural handoff; claims below verified against code).

---

## Executive Summary

This is a **new, standalone consumer racing‑prediction product** (marble racing / Hot Wheels‑style) built by cloning the production‑ready `brohda-rc1` codebase and subtracting football, **not** by layering racing onto Brohda and **not** by building a multi‑sport platform.

The clone is the right strategy for one verified reason: Brohda's hardest‑won, most safety‑critical machinery — the **wallet/settlement engine** and the **RPC privilege security model** — is already domain‑agnostic. I confirmed this directly against the baseline: the migration defining `confirm_pool_settlement` and `prepare_pool_settlement_manual` (`20260101000102`) contains **zero** football tokens, while the legacy football grader `prepare_pool_settlement` (`20260101000010_settlements.sql`) contains 26. Racing needs to change **only the code that decides which pool option won** — everything downstream of that (payout math, ledger, refunds, reversals, idempotency, settlement) stays byte‑for‑byte identical.

The plan is a sequence of **narrow, independently testable phases**. Football is removed in two safe stages — the external **ingestion layer** early (it has no racing replacement and removing it only shrinks surface), and the **core football tables/code** last (after racing replaces every call site), following dependency safety rather than cosmetic cleanliness. The protected financial/security core is frozen throughout, with explicit STOP/REVIEW gates if any phase proposes touching it.

**Recommended V1 launch scope:** Single Race + Championship/League, two prediction templates (Race Winner, Competition Winner), an organizer role with **many‑to‑many, assignment‑scoped** authorization, organizer‑entered results driving automatic grading→settlement, and super‑admin corrections via the existing reversal machinery. Knockout/elimination/mixed formats — with **automatic, result‑derived progression** — are built on the same schema and sequenced immediately after the first Single Race loop works, activated post‑launch.

**Recommendation: proceed.** Isolation is clean, the baseline is verified, and the report's structural claims hold.

---

## Verified Starting State

Established this session by direct read‑only inspection of the clone (not assumed from the report):

| Claim | Verified? | Evidence |
|---|---|---|
| Baseline is `brohda-rc1` @ `595702c`, clean tree | ✅ | `git rev-parse HEAD` = `595702c5…`; top commit "Add PUBLIC_LAUNCH_RELEASE_REPORT.md for brohda-rc1" |
| Working tree complete | ✅ | 107 migrations; `app` (16), `lib` (25), `components` (21), `tests` (4) dirs present |
| Money RPCs are domain‑agnostic | ✅ | `20260101000102` (confirm/prepare) has 0 football tokens; legacy `settlements.sql` has 26 |
| `pools.fixture_id` FK (the ADAPT target) | ✅ | `20260101000009_pools.sql:34` — `fixture_id uuid not null references public.fixtures(id)` |
| `pool_options` has no cardinality cap (N options OK) | ✅ | Only a *partial* unique index `pool_options_unique_binary_outcome` (scoped to `binary_outcome`) |
| Role model = `super_admin \| admin \| player`; guards exist | ✅ | `admin` added `20260101000020`; `requireSuperAdmin()`/`requireAdminOrAbove()` at `lib/auth/session.ts:46,56` |
| Admin‑hierarchy tree is dormant (must not repurpose) | ✅ | `parent_admin_id`/`get_branch_member_ids` in `000063`; **0** call sites in `lib`/`app`/`components` |
| RPC privilege boundary test exists | ✅ | `tests/integration/rpc-privilege-boundary.test.ts` (14.8 KB, `PROTECTED_RPCS`, `42501`) |
| `fixtures.sport` free‑text (separability premise) | ✅ | `20260101000008_fixtures.sql` — `sport text not null default 'football'` |
| Football subtraction surface as described | ✅ | `lib/sports-data` (10 files), `lib/competitions` (10), 4 football‑only crons, admin `competitions`/`fixtures`/`fixture-archive` |
| N‑option hardcoding is narrow (3 spots) | ✅ | `MatchIdentity.tsx` (2× `TeamBadge`), `templates.ts` `generatePoolTemplate` (literal "Draw"), + `grade.ts` binary resolution (per report) |

**Conclusion:** the report is trustworthy on its load‑bearing claims. The two things the brief forbids touching casually — settlement and RPC privilege — are verified domain‑agnostic and intact.

---

## Isolation Status

**CLEAN — verified isolated. No production exposure.**

What was found and resolved this session:
- The original `Racing-project` folder was **not a fork** — it held only the report, nested inside the user's home directory, which is itself a git repo wired to `github.com/asaenz76/goodnightpost.git`.
- The real `brohda-rc1` baseline lives at `/Users/andresaenz/Claude/PollPools`, wired directly to `github.com/asaenz76/brohda.git` (**production**) at the release commit — the dangerous path.
- A clean clone was created at `/Users/Shared/racing-project`:

| Check | Result |
|---|---|
| Git root | `/Users/Shared/racing-project` (outside the home‑dir repo) ✅ |
| Own `.git` | Yes — git commands here no longer touch the home/goodnightpost repo ✅ |
| Remotes | **Empty** — no `brohda.git`, no `goodnightpost.git` ✅ |
| HEAD | `595702c` (baseline) ✅ |
| Secrets | No `.env`, no `.vercel`, no `.supabase` link; only `.env.example` template ✅ |

**Remaining isolation actions (before any deploy, not required for planning):**
1. Create a **new empty GitHub repo** for racing; set it as `origin`. Never re‑add `brohda.git`.
2. Provision a **separate Supabase project** and **separate Vercel project**; never `supabase link` to Brohda's, never reuse Brohda's keys.
3. (Optional hygiene) The user's home directory being a git repo tracked to `goodnightpost` is unrelated to racing but worth cleaning up so nothing commits by accident.

---

## Architectural Invariants

These govern every phase:

1. **The money invariant (verbatim):** *"Racing may change event creation and outcome grading. It must not change how money is entered, calculated, settled, refunded, reversed, or ledgered unless repository evidence proves a change is unavoidable."* No such evidence exists — grading is entirely **upstream** of money movement and hands a `winning_option_id` to unmodified RPCs.
2. **Grading is upstream of money.** New racing grading code produces a winning option and calls `prepare_pool_settlement_manual` → `confirm_pool_settlement`, exactly as `gradeTemplatePool()` does today. It never edits those RPCs.
3. **Security boundary is the GRANT, not `auth.uid()`.** Every mutating RPC is `service_role`‑only; the Postgres grant *is* the authorization boundary. New organizer capabilities go through **Server Actions + `createAdminClient()`** with in‑TypeScript role+ownership checks — never a widened grant, never a role‑check bolted inside a generic RPC.
4. **Result → grading → settlement separation is preserved.** Organizers record the *real race result*; grading logic (not the organizer) derives the winning pool option; settlement is automatic.
5. **Subtract, don't universalize.** No plugin framework, no multi‑sport engine, no shared Brohda/Racing database, no monorepo. One racing engine for marbles and Hot Wheels.
6. **Preservation by default.** Domain‑agnostic infrastructure is reused unchanged; nothing is refactored merely because it could be designed differently.
7. **Subtraction follows dependency safety.** Introduce racing replacement → move call sites → verify → delete obsolete football. Never delete load‑bearing football code before its racing replacement exists.

---

## Protected Brohda Core

**Frozen. Any phase that proposes changing one of these triggers a mandatory STOP/REVIEW gate before implementation.**

**Money‑moving RPCs (zero changes):**
- `apply_wallet_transaction` — the single money‑movement chokepoint
- `confirm_pool_settlement`, `confirm_pool_refund`, `confirm_combo_refund_fee_retained`
- `prepare_pool_settlement_manual` — the exact RPC racing grading calls
- `reverse_pool_settlement`, `abort_pool_reversal`, `undo_pool_grading`
- `create_pool_entry`, `void_pool_entry`

**Ledger / audit (append‑only, mutation‑forbidding triggers preserved):**
- `wallet_transactions` (incl. its deliberately FK‑less `pool_id`/`entry_id`/`settlement_id`), `wallet_balances`
- `entries`, `settlement_payouts`, `settlements` (payout/fee math)
- `audit_logs`, `pool_grading_evidence`

**Conventions & security:**
- Idempotency‑key convention `base_key:suffix` (`:payout:`, `:house_fee`, `:remainder`, `:refund:`, `:reversal:`) — new callers must follow it, not invent new keys
- RPC privilege model (migration `20260101000107`) + `rpc-privilege-boundary.test.ts` — no new mutating grant to `authenticated`; every new privileged RPC added to `PROTECTED_RPCS`
- `is_super_admin`/`is_admin_or_above` and `requireSuperAdmin()`/`requireAdminOrAbove()` — helper bodies extended alongside, never modified; money/account/role/audit stay **super‑admin‑only**. `super_admin` is the only global privileged role; legacy `admin` is never treated as `super_admin` and never bypasses `competition_organizers` assignments (racing authorization uses `is_super_admin OR assignment`, never `is_admin_or_above`)

---

## Target Racing V1

**Domain:** `Competition → Stage (optional) → Race → Competitor → Result → grading → existing settlement`.

**In V1 launch scope:**
- **Formats:** Single Race (first‑class), Championship, League. (Schema also carries `BRACKET/ELIMINATION/MIXED` enum values, exercised in post‑V1 phases.)
- **Roles (target model):** **Super Admin, Organizer, Player.** Organizer is a new role whose authority is **assignment‑scoped** (many‑to‑many) to its assigned competitions and their descendants — never global. The inherited Brohda `admin` enum value survives only as a **technical transition artifact** (see Organizer Authorization Strategy), not as a target product role.
- **Competitors:** persistent (library) or race‑only, identified by any of name / number / up to **4 colors** / image — at least one meaningful attribute.
- **Templates:** **Race Winner**, **Competition Winner** only.
- **Results:** winner required; full finishing order optional (structured placements supported). Organizer‑entered, organizer‑confirmed, super‑admin‑correctable.
- **Grading:** event‑triggered from the result‑confirmation Server Action; reconciliation cron as safety net only.
- **Economics:** preserved unchanged (equal entry, community sentiment, Picked‑by‑X%, estimated payout, platform fee, everybody‑wins/nobody‑wins refunds with no fee, automatic settlement, idempotent ledger, reversal).
- **Player surface:** feed, N‑competitor pool cards, pool detail, comments, follows (renamed), profile, leaderboard, notifications, search, wallet — mostly unchanged.

---

## Explicitly Deferred Features

Deferred by **sequencing** (built on the same schema, after the first Single Race loop works — not excluded from the product):
- Knockout / Elimination / Mixed formats and their **automatic, result‑derived progression engine** — architecture supports them from Phase 2; the engine itself is built in Phase 8, not before Single Race + Championship V1 launches.

Deferred by **exclusion** (schema must not block them, but no V1 code):
- **Podium Finish / Head‑to‑Head** templates — require partial finishing order that conflicts with the winner‑only common case; defer past V1.
- Exact finishing order / Top‑2 / last place / next‑eliminated / lane / position‑range / win‑count templates.
- Any odds/consensus/de‑vig pipeline for racing (no external odds source; the football odds math stays dormant, unused).
- Configurable tiebreaker trees / arbitrary rules language for standings (a standings tie that prevents an unambiguous winner routes the pool to manual review instead).
- A general dispute‑resolution platform (reuse reversal/undo‑grading + super‑admin correction/rebuild instead).
- Multi‑sport/plugin architecture, shared DB, monorepo.

---

## Current‑to‑Target Architecture

Three layers today; racing keeps two nearly intact and replaces one:

1. **Provider/data layer** (`lib/sports-data/*`, `lib/competitions/*`, `fixtures`/`teams`/`leagues`/import tables, 4 crons) → **REMOVED**. Racing results are organizer‑entered; there is no external provider.
2. **Pool/prediction engine** (`lib/pools/*`, settlement RPCs) → **plumbing REUSED unchanged**, **content REPLACED** (football template bodies + legacy SQL grader → racing grading adapter).
3. **Consumer shell** (auth, social, wallet, notifications, leaderboard, admin, design system) → **REUSED**, with a thin band of racing adaptation (N‑competitor header, feed/search data source, follows rename).

**New event‑source hierarchy** replaces the provider layer: `racing_competitions → competition_stages? → races → race_competitors → race_results (+ race_result_positions)`, bridged to `pools`/`pool_options` by a new grading adapter that terminates in the unchanged settlement RPCs.

---

## Database Strategy

**Chosen: Strategy A — preserve `brohda-rc1` migration history as ancestry and add racing migrations. Do not squash/rebaseline.**

Rationale (conservative post‑incident, per the brief):
- The corrected RPC‑grant patterns from the security incident live in the existing migration set; starting from them (not a hand‑authored snapshot) is the safest way to avoid re‑introducing grant drift.
- Traceability > migration aesthetics. A squash risks silently dropping a hardening statement.
- Because this is a **separate Supabase project**, "remove a football table" means **never creating it in the racing project's applied schema** — achieved by dropping it in a late racing migration after code no longer references it (the tables still exist in ancestry history, which is fine and auditable).

**Migration ordering principles:**
- Additive/relaxing changes first (add `race_id` nullable, relax `pools.fixture_id` to nullable, add `pool_options.competitor_id`).
- Enum additions are **one‑way doors** (Postgres can't drop enum values) — get names right before merge; each in its own single‑statement migration (the proven `'admin'` pattern).
- Destructive drops (football tables, `fixture_id` column, legacy `prepare_pool_settlement`) isolated into their own late, individually revertable migrations.

---

## Organizer Authorization Strategy

**Target role model — Super Admin, Organizer, Player. No additional roles.**
- **Super Admin:** full system control (money, users, audit, settings, all competitions, corrections/rebuilds).
- **Organizer:** assignment‑scoped racing management only. No global admin privileges of any kind.
- **Player:** normal consumer.

**Inherited `admin` role — LEGACY TECHNICAL ROLE, NO NEW PRODUCT USE.** The baseline `user_role` enum is `super_admin | admin | player`; Postgres cannot drop an enum value, so `'admin'` **remains in the enum for migration compatibility only**. It is **not** part of the racing product's role model, and — critically — it **does not automatically receive Super Admin authority**:
- **`super_admin` is the only global privileged role.** `'admin'` must **not** be treated as equivalent to `super_admin`.
- **Legacy `admin` must not bypass competition assignments.** An `admin` user gets **no** access to a racing competition unless they also hold an explicit `competition_organizers` assignment (i.e. `admin` is, for racing purposes, treated no better than `organizer`‑without‑assignment — effectively no racing authority).
- **No new users are ever created with the legacy `admin` role.** Organizer is the only new grant; Super Admin is promotion‑only for global authority.
- **Every inherited `requireAdminOrAbove()` call site must be audited before reuse** (Phase 3): each is either (a) re‑pointed at `requireSuperAdmin()` where it genuinely gates global/money/account/audit authority, or (b) re‑pointed at the new assignment‑based organizer check where it gates scoped racing management, or (c) retired with its route. `requireAdminOrAbove()` is **not** reused as‑is for any racing authorization unless it is first rewritten to exactly match this permission model. The audit's findings (which call sites go which way) are documented in Phase 3.

**Role add:** one enum value `'organizer'` on `user_role` (single‑statement migration, `'admin'` precedent). Organizers are **promotion‑only** (Super Admin promotes a player); no invite‑as‑organizer flow in V1.

**Assignment model — MANY‑TO‑MANY (`competition_organizers` join table):**
- `competition_organizers` — `competition_id references racing_competitions(id)`, `organizer_id references user_profiles(id)`, `assigned_by references user_profiles(id)`, `assigned_at`, primary key `(competition_id, organizer_id)`.
- A Super Admin may assign **one or more** organizers to a competition; an organizer may be assigned to **one or more** competitions.
- `racing_competitions` carries **no** `organizer_id` column — ownership is expressed entirely through this join table. (Rejected the single‑column model because the founder decision requires many‑to‑many; the join table is the standard, safe shape and adds no security surface beyond one more service‑role‑written table.)
- Authorization for a race / competitor‑in‑race / result / racing pool cascades through its parent `competition_id`.

**Guard:** add a **new, purpose‑built** `requireOrganizerOrAbove()` in `lib/auth/session.ts` — it does **not** delegate to `requireAdminOrAbove()`. It is only a **coarse gate** ("is this user even eligible to attempt organizer actions": an `organizer`, or a `super_admin`); it does **not** grant access to any specific competition, and legacy `admin` alone does not clear it into any competition. The real authorization for every organizer mutation is an explicit per‑resource check inside a **Server Action**:

```
authorized = is_super_admin(user)
             OR EXISTS(competition_organizers
                       WHERE competition_id = <target's owning competition>
                         AND organizer_id  = user.id)
```

Never `is_admin_or_above(user)`. Concretely, each organizer mutation:
1. verifies eligibility (organizer or super_admin),
2. resolves the target's owning `competition_id`,
3. asserts the `is_super_admin OR competition_organizers` predicate above — the assignment check is the real boundary,
4. then calls the `service_role` client.

**Security boundary (non‑negotiable):** no new mutating RPC is granted to `authenticated`; organizer authority is enforced entirely in TypeScript before the service‑role call. Legacy `admin` grants **no** implicit global or racing authority. Any genuinely new RPC follows `revoke all … from public, anon, authenticated; grant execute … to service_role;` and is added to `PROTECTED_RPCS`. This starts the racing product from an *already‑correct* posture rather than giving RPC‑grant drift a second chance.

**Resolved defaults:** Super Admin **can** assign, reassign, and unassign organizers at any time (one or more per competition); assignment grants scoped management of that competition and its descendants **only**; an organizer assigned to competition A can never touch competition B unless also assigned to B.

---

## Competitor Strategy

Single `competitors` table (not a `teams` rename — `teams.name` is `not null` and its `provider/external_id` shape exists only to dedupe a feed racing lacks):

- `id`, `name text NULL`, `number text NULL`, `colors text[] NULL` (max 4 enforced in Zod/Server Action, not a DB CHECK), `image_url text NULL`
- `is_persistent boolean not null default true` — the "save for future races" checkbox; a race‑only competitor is `false`, still a permanent row (promotion later is a one‑column update, no data migration)
- `is_active boolean not null default true` — soft delete (never hard‑delete; `race_competitors`/`race_results` keep FK integrity), following `user_profiles.is_active`
- `created_by uuid references user_profiles(id)` (audit), `created_at`/`updated_at`. **No owning‑organizer column** — competitor write authorization is scoped through the competition context in which the competitor is used (via `competition_organizers`), plus the creator and Super Admin for standalone library competitors. This keeps a persistent competitor usable across many competitions without pinning it to one organizer.
- **"At least one identifying attribute" enforced at the application layer** (Zod), not a brittle 4‑column DB CHECK

`race_competitors` (join table) links a competitor to a specific race and carries race‑specific data (starting position, lane); `competitors` itself carries no race data, keeping the library/race‑only distinction purely about reuse.

---

## Competition / Stage Strategy

Smallest composable model that covers every named format without per‑format engines:

- **`racing_competitions`** — `id`, `name`, `format` enum (`SINGLE_RACE | CHAMPIONSHIP | LEAGUE | BRACKET | ELIMINATION | MIXED`), `status`, `points_config jsonb` (position→points map; default preset below, no rules engine), timestamps. **No `organizer_id`** — ownership is the `competition_organizers` join table (many‑to‑many). Dramatically lighter than `league_season_imports` — no import/sync/coverage columns.
- **`competition_stages`** (optional) — `id`, `competition_id`, `name`, `stage_type` enum (`RACE | POINTS_STANDINGS | GROUP | KNOCKOUT`), `sequence_order int`, `status` (`UPCOMING | ACTIVE | COMPLETED`), `advancement_rule jsonb NULL` (for elimination/knockout — e.g. "top N advance"; null for standings/single). A `SINGLE_RACE` competition has **zero** stages (its race points at `competition_id` with `stage_id = null`); a `MIXED` competition has one stage per phase.

**Championship and League share one engine:** both are `format` values whose races group under `POINTS_STANDINGS` stages (or none). **Standings are computed live** at read time from `race_results` using `points_config` (following the `get_leaderboard` "compute, don't store" precedent) — no second source of truth.

**Bracket and Elimination share primitives:** both are `KNOCKOUT` stages where a confirmed race's result **deterministically derives** who advances. Advancement is **automatic** (see Competition Progression Strategy), not manual — the organizer defines the bracket structure once (which race feeds which slot), and the system fills downstream slots from confirmed results. Manual intervention is reserved for ambiguous/corrected results, ties, and Super‑Admin rebuild.

---

## Race and Result Strategy

**`races`** — `competition_id` (FK, required), `stage_id` (FK, nullable), `race_number/label`, `scheduled_start_utc`, `locks_at` (pattern from `pools.locks_at`), `status` enum (`SCHEDULED | IN_PROGRESS | COMPLETED | POSTPONED | CANCELLED | ABANDONED`), `winner_competitor_id` (nullable until known), `video_url` (nullable), `original_race_id` (nullable, for rerun linkage), timestamps. Ownership is derived from `competition_id` via `competition_organizers` (no per‑race owner column). **Deliberately excludes** every `fixtures` provider column (`provider`, `external_id`, `*_payload`, `sync_error`, `last_synced_at`) — this is a REPLACE, not an adapt.

**`race_competitors`** (join, links a competitor to a race) — `race_id`, `competitor_id` (nullable while a slot is a placeholder), `starting_position/lane` (nullable), plus **progression‑slot fields** laid down now so automatic advancement needs no later rewrite: `source_race_id uuid NULL` (the upstream race that fills this slot), `source_rule enum('WINNER','POSITION') NULL`, `source_position int NULL`, `is_placeholder boolean not null default false`. For Single Race / Championship these are all null/false; for Knockout/Elimination a downstream slot is created as a placeholder referencing its source race, and the system fills `competitor_id` automatically when the source result confirms unambiguously (Phase 8).

**Result model (winner required, order optional):**
- **`race_results`** — `race_id` (unique), `winner_competitor_id not null`, `status` (`PENDING_CONFIRMATION | CONFIRMED | CORRECTED`), `confirmed_by`/`confirmed_at`, `corrected_by`/`corrected_at`/`correction_reason` (audit trail), `created_at`.
- **`race_result_positions`** (0..N per race) — `race_id`, `competitor_id`, `position int NULL` (unknown allowed for partial order), `finish_status` enum (`FINISHED | DNF | DSQ | DID_NOT_START`). Winner‑only = one row (winner, pos 1) + the required `winner_competitor_id`. Full order = N rows. Future Top‑3/exact‑order templates read the same table — **no schema change needed later**; they grade `PENDING` if the rows they need aren't present, following `gradeTemplatePool`'s "never coerce missing data" rule.

**Separation preserved:** organizer records the *result*; the grading adapter (not the organizer) derives the winning pool option; settlement is automatic.

---

## Prediction Template Strategy

**Registry mechanism reused** (`PoolTemplate` interface, `getTemplate`/`getLatestTemplate`, Zod config validation, `YES|NO|VOID|PENDING` contract) — domain‑agnostic, keep. **All 17 football template bodies replaced.**

**Key structural nuance (verified):** "Race Winner" (pick 1 of N) is **not** the binary `TEMPLATE_GRADED` shape (which grades YES/NO against a fixed option pair). It resembles the *legacy* `WHO_WILL_ADVANCE` "pick one named option" pattern — which lives in SQL reading `fixtures` and is being removed. So Race Winner needs a **new grading pathway**, not a reuse of the binary registry pattern.

**V1 templates:**
1. **Race Winner** — needs only `race_results.winner_competitor_id`.
2. **Competition Winner** — same primitive, sourced from final competition standings/outcome instead of a single race.

**Deferred (challenged as instructed):** Podium Finish and Head‑to‑Head *are* clean binary fits for the existing registry — but both need partial finishing order, which conflicts with the winner‑only common case (they'd sit `PENDING` whenever an organizer enters only the winner). Defer past V1; when built, require full order for those templates specifically.

---

## Grading Strategy

New pipeline, entirely upstream of money:

```
Confirmed race_results (winner required)
  → gradeRacePool() adapter  [NEW — parallels gradeTemplatePool()'s control flow]
      resolve template/config → match pool_options.competitor_id against
      race_results.winner_competitor_id → resolve winning option
  → write pool_grading_evidence   [UNCHANGED table, new evidence content]
  → prepare_pool_settlement_manual [UNCHANGED RPC]
  → confirm_pool_settlement        [UNCHANGED RPC]
  → notifications / leaderboard    [UNCHANGED]
```

- Matching is by a **real `competitor_id` FK**, replacing `grade.ts`'s denormalized label‑string fallback — cleaner and safer.
- **Event‑triggered**, synchronous from the result‑confirmation Server Action (racing results are an organizer action, not an async feed) — avoids inheriting the football `sync-fixtures` self‑overlap bug. The adapted `process-results` cron is retained **only** as a reconciliation safety net for missed processing.
- **Ambiguity → manual review, never auto‑settle.** If the confirmed result cannot yield exactly one unambiguous winner (tie/dead‑heat, DSQ'd would‑be winner, abandoned), route the pool into the existing `MANUAL_REVIEW` status with a new `pool_review_reason` value `RACE_RESULT_UNRESOLVABLE` (generalizing the existing `BINARY_OPTIONS_UNRESOLVABLE` pattern). Super‑admin resolves or refunds. No new payout engine.

---

## Settlement Preservation Strategy

**No settlement/wallet code changes.** The entire chain from "resolve winning option" onward is frozen (see Protected Core). Racing's grading adapter's only interface to money is the same two calls `gradeTemplatePool` already makes. Preserved unchanged: equal/fixed entry, community sentiment, Picked‑by‑X%, estimated payouts, platform fee, payout calc, everybody‑wins and nobody‑wins refunds (no fee on those), automatic settlement, ledger, idempotency, reversal.

**Corrections after settlement** reuse `reverse_pool_settlement`'s existing dry‑run‑then‑commit pattern (already handles the un‑clawback‑able case via `REVERSAL_FAILED_MANUAL_REVIEW`) — no new clawback logic.

---

## Competition Progression Strategy

**Progression is automatic when the confirmed result is deterministic and unambiguous.** The organizer never manually copies a known winner into a subsequent race — the system derives advancement from the authoritative confirmed result.

- **Standings (Championship/League):** computed live from `race_results` via `races → stage/competition`, using `points_config`. Read‑only computation; touches no money code.
- **Knockout/Elimination:** the bracket structure is declared once at creation as **placeholder `race_competitors` slots** (`source_race_id` + `source_rule`/`source_position`; stage‑level `advancement_rule` for "top N survive"). On a confirmed, unambiguous result, the **progression step** — invoked from the result‑confirmation Server Action, immediately after grading→settlement — fills the matching downstream slot(s) with the derived competitor(s):
  - Quarterfinal winner → the semifinal slot whose `source_race_id` is that quarterfinal, `source_rule = WINNER`, is auto‑populated.
  - Semifinal winner → the final slot is auto‑populated.
  - Elimination stage complete → survivors (per `advancement_rule`) are seeded into the next stage's races.
- **Mixed:** a sequence of stages with different `stage_type`s under one competition — no special‑casing beyond the bullets above.

**Manual intervention is reserved (progression HOLDS, does not fire) for:** ambiguous results, ties/dead heats, corrected results, invalid progression state, and Super‑Admin correction/rebuild. When a result cannot deterministically resolve advancement, the downstream slot stays a placeholder and the competition surfaces a manual‑resolution prompt — the same "never coerce" discipline used for grading.

**Correction safe‑mutation boundary (invariant — the highest‑risk path, gated).** A corrected upstream result may be **automatically propagated only while every affected downstream object is still safely mutable.** Result corrections must **not** blindly rewrite downstream competition history. On a correction, the system first computes the **downstream dependency chain** and classifies it:

- **Auto‑rebuild allowed** — only when, for *every* affected downstream race, it has **not started**, has **no confirmed result**, has **no settled pool**, and holds **no other irreversible competition state**. Then the correction deterministically rebuilds, in order: (1) re‑derive progression from the corrected result, (2) rebuild the downstream placeholder `race_competitors` slots, (3) re‑open/re‑grade any *unsettled* downstream pools. **No money moves**, because nothing downstream had settled.

- **STOP → SUPER ADMIN REVIEW** — if any affected downstream race has **started**, has **locked pools with real entries**, has a **confirmed result**, has a **settled pool**, or its **advancement was already used to produce later confirmed results.** Automatic propagation halts. The system **shows the full dependency chain that would be affected before anything is reversed**, and routes the correction to the Super‑Admin manual workflow, which uses the **unchanged** `reverse_pool_settlement`/`undo_pool_grading` machinery (dry‑run‑then‑commit; un‑clawback‑able → `REVERSAL_FAILED_MANUAL_REVIEW`) only where a reversal is genuinely required. **The system never silently auto‑reverses an entire tournament tree because one upstream result changed.**

For V1: prefer safe deterministic rebuild when nothing downstream is finalized; otherwise the manual Super‑Admin correction workflow (auditable). This boundary lives in Phase 8 (only Knockout/Elimination create cross‑race dependencies); Single Race and Championship (V1 launch) have no cross‑race progression dependency, so a correction there affects only its own race/pool.

---

## Football Subtraction Strategy

Three stages, dependency‑safe. **Correction (verified against the code during Phase 1 recon):** the original two‑stage split assumed the whole `lib/sports-data/**` provider cluster was cleanly removable in Phase 1. The actual import graph shows it is a **temporary bridge dependency** of currently‑KEEP code: `lib/actions/pools.ts` (pool‑creation core) → `lib/actions/odds.ts` → `apiFootballProvider`; the Phase‑4 pool wizard (`admin/pools/new/*`) → `odds.ts`/`squads.ts`/`supported-competitions`; and the grading path imports `FixtureInternalStatus`/`NormalizedFixture` **types** from `sports-data/types.ts`. Removing the provider now would force pool‑creation/grading edits that belong to Phases 4–5. So provider removal moves to those phases.

**Stage A (Phase 1) — automated ingestion + orchestration + operational admin surface, proven safely separable:**
- `lib/competitions/**` (import orchestration) and `lib/fixtures/**` (fixture query/display helpers used only by the removed admin fixtures browser)
- Ingestion actions: `lib/actions/competitions.ts`, `lib/actions/fixtures.ts`, `lib/actions/fixture-discovery.ts`
- Crons: `sync-fixtures`, `discover-competitions`, `process-competition-imports`, `refresh-recommendation-cache`
- Admin: `admin/competitions/**`, `admin/fixtures/**`, `admin/fixture-archive/**`, `provider-status-panel` (+ drop its usage from `admin/settings`)
- Provider/import tables: `provider_request_log`, `league_season_imports`, `competition_import_jobs(+chunks)`, `competition_availability_cache`, `fixture_date_search_cache` — **not** `fixture_odds_cache` (still written by the retained `odds.ts`)
- Import RPCs: `claim_import_job_chunks`, `cleanup_import_job_chunk_payloads`, `recalculate_import_job_progress`
- Tests for the above removed modules only

**Stage B — TEMPORARILY RETAINED bridge dependencies — REMOVE AFTER RACING REPLACEMENT IS WIRED (Phases 4–5), not before:** their temporary survival is **not** a decision to preserve football support.
- `lib/sports-data/**` (provider client `api-football-provider.ts`, `provider-gateway`, `status-map`, `sync`, `persist`, `http`, `timezone`, `supported-competitions`, `events`, and `types.ts`)
- `lib/actions/odds.ts`, `lib/actions/squads.ts`
- `fixture_odds_cache` table
- `API_FOOTBALL_BASE_URL/KEY/ENABLED` env
- Provider‑dependent pool‑creation wizard logic (`admin/pools/new/*` fixture/competition/odds/squad steps)
- Grading types imported from `sports-data/types.ts` (relocated in Phase 5 when the racing result model exists — no early churn)
- Removed in: **Phase 4** (provider client, `odds.ts`, `squads.ts`, `supported-competitions`, `fixture_odds_cache`, `API_FOOTBALL_*`, wizard football steps — once the racing pool‑creation path replaces the fixture wizard) and **Phase 5** (grading `types.ts` — once the racing grading adapter/result model lands).

**Stage C (Phase 11) — core football tables/code, after racing replaces every call site:**
- Tables: `fixtures`, `teams`, `leagues`, `team_players`, `team_follows`, `league_follows`; view `fixtures_available_for_pool_creation`
- Legacy `prepare_pool_settlement` (football SQL grader) and `pool_type` `WHO_WILL_ADVANCE`/`REGULATION_RESULT`
- `pools.fixture_id` column (drop after `race_id` fully adopted)
- 17 football template bodies; remaining football tests; football seed scripts (rewrite, not delete — dev‑seed product need persists)

**Classify by responsibility, not filename:** `lock-pools`/`process-results` crons stay (generic lifecycle); the odds de‑vig math stays dormant until removed with `odds.ts` in Phase 4.

---

## Admin / Organizer UX Strategy

**Reused unchanged:** `admin/users(+role form gains 'organizer')`, `admin/invitations`, `admin/wallet-requests`, `admin/audit-log`.
**Adapted:** `admin/settings` (drop provider‑status widget), `admin/reports`/`analytics` (rename any football dimensions), `admin/pools` list/detail/lifecycle (keep; only the creation wizard's fixture‑picker is replaced).
**Removed:** `admin/competitions/**`, `admin/fixtures/**`, `admin/fixture-archive/**`.
**New (lighter than football — no provider workspace):** competitor library, race creation/scheduling, result entry + confirmation, result correction (super‑admin), flat competition/stage management (no bracket‑builder UI in V1).

---

## Player UX Adaptation

**Keep (verified already N‑agnostic):** `PoolOptionButton`, `PoolDistributionBar`, `AvatarStack`, `SocialPoolCard`/`PoolPreviewCard` containers, pool detail, comments, generic follows, profile core, leaderboard, notifications/activity, wallet, design system. The brief's "Red Rocket — Picked by 50% — Est. payout $9.90" already renders with zero changes.
**Replace:** `MatchIdentity` (2‑sided "VS") → N‑competitor‑aware race header (introduced minimally in Phase 4 for testability; polished in Phase 10).
**Adapt (data source only):** feed's `fixtures` join → races/competitions; `PoolLeagueHeader` ("kickoff" → "start time"); search fixture branch → race/competitor/competition (`.ilike()` pattern); profile "Following" tab → competitor/competition follows.
**Replace:** `team_follows`/`league_follows` → `competitor_follows`/`competition_follows` (same idempotent‑toggle pattern); rules page (full rewrite — 100% football prose).

---

## Security Strategy

1. **No new mutating RPC to `authenticated`** — organizer/result/competitor/race capabilities go through Server Actions + `createAdminClient()`.
2. **Organizer authority in TypeScript only** — role + resource‑ownership check before the service‑role call; never a widened grant, never a role‑check inside a generic RPC.
3. **Any new RPC** follows the `revoke…grant to service_role` pattern and is added to `rpc-privilege-boundary.test.ts::PROTECTED_RPCS` so accidental widening fails CI.
4. **RLS on new tables** mirrors `fixtures` posture (broad `authenticated` read; writes via `service_role`); narrower organizer‑draft policies, if built, join through `competition_organizers` — not a wider grant.
5. **Explicit organizer authz tests** (below) are a required gate, including the negative "organizer cannot touch another organizer's competition."

---

## Testing Strategy

Classification (per the brief) and regression gates after **every** phase.

- **KEEP UNCHANGED (~40 unit / ~19 integration):** all generic infra — `guards`, `money`, `settlement-logic`, `reversal-logic`, `streaks`, `pool-view-model`, `enter-pool-action`, `notification-*`, `wallet-*`, `rls`, **`rpc-privilege-boundary`**, `reversal`, `leaderboard`, `registration`, `follows`, `pool-*`, `invite-flow.spec.ts`, etc. **These stay green throughout the conversion.**
- **ADAPT (~10 unit / ~5 integration):** retarget football‑flavored data at races — `fixture-persist`→`race-persist`, date/grouping/filter tests, `social-pool-card`/`pool-league-header`, `team-follows`→`competitor-follows`, `settlements.test.ts` (keep the math, retarget the pool type), bulk‑creation test.
- **REMOVE (~15 unit / ~10 integration):** provider client, import machinery, football template content, eligibility wiring.
- **NEW racing coverage (required):** arbitrary N competitors (2, 3, **5+**); competitor identity (1–4 colors, name/number‑optional, ≥1‑attribute rule); persistent + race‑only + promotion; **organizer many‑to‑many authorization** (authorized on assigned / denied on unassigned / wrong‑role / multi‑assignment / Super‑Admin bypass); winner‑only grading; full‑order grading; result confirmation → grading → settlement end‑to‑end; **ambiguous‑winner → manual review**; everybody‑wins refund; nobody‑wins refund; correction/reversal after settlement; standings computation + standings‑tie → manual review; **automatic knockout/elimination advancement** (deterministic auto‑fill; ambiguous/tie holds); **correction safe‑mutation boundary** (auto‑rebuild when nothing downstream finalized; → Super‑Admin review when downstream has started/locked‑with‑entries/confirmed/settled; multi‑stage correction shows the dependency chain, no silent cascade); mixed‑stage traversal; **legacy `admin`‑without‑assignment denied on every racing competition**; **RPC privilege boundary for every new RPC**.

CI structure (`quality`/`integration`/`e2e`, local‑Supabase pattern) reused; integration/e2e env blocks drop the three `API_FOOTBALL_*` lines.

---

## Environment / Deployment Isolation

- **Env:** remove `API_FOOTBALL_*` **in Phase 4** (temporarily retained through Phase 1 while the provider client is still imported by the KEEP pool‑creation/wizard path); keep Supabase/`CRON_SECRET`/`RESEND`/`SENTRY`/`APP_URL`/`DEFAULT_TIMEZONE`. New racing values only — never Brohda's.
- **Supabase:** brand‑new project; migrations applied fresh; never `link` to Brohda.
- **Vercel:** brand‑new project; `vercel.json` stays minimal (`{"regions":["pdx1"]}`).
- **Cron:** external scheduler (cron‑job.org) `CRON_SECRET` pattern reused; only `lock-pools` + adapted `process-results` remain.
- **GitHub:** new empty racing repo as `origin`; the clone currently has **no** remote (safe default).

---

## Implementation Phases

Each phase: **implement → test → review → commit → continue.** Regression gate (KEEP‑tests green, incl. `rpc-privilege-boundary`) after every phase.

> **Ordering note (challenging the brief's suggested order):** football removal is **split**. External *ingestion* is removed early (Phase 1) because nothing racing‑side replaces it and its removal only shrinks surface. *Core* football tables/code are removed **last** (Phase 11), after racing replaces every call site — deleting `fixtures`/`fixture_id`/grading early would break pool creation, feed, and grading before racing can render or grade anything. This is the safest sequence, not the prettiest.

### Phase 0 — Isolation & baseline verification  ✅ (this session)
- **Objective:** independent clone, verified isolated, report validated against code.
- **Status:** complete — clone at `/Users/Shared/racing-project`, remotes detached, baseline `595702c`, claims verified.
- **Remaining before deploy:** new GitHub/Supabase/Vercel projects (isolation actions above).
- **Completion criteria:** met. **Rollback:** delete the clone (nothing shared).

### Phase 1 — Remove the automated football ingestion & its operational surface
- **Objective:** remove the automated football **ingestion / orchestration / operational admin surface** that is proven safely separable **now** — without touching pool creation, grading, settlement, wallet, or the future racing replacement. (Scope corrected from "remove the whole provider layer" after Phase‑1 recon proved the provider cluster is a temporary bridge dependency of KEEP pool‑creation/grading code — see Football Subtraction Strategy, Stage A vs Stage B.)
- **Why now:** the largest football surface that is genuinely self‑contained; removing it de‑risks later phases and leaves no provider *operations* running.
- **Systems affected (REMOVE):** `lib/competitions/**`, `lib/fixtures/**`, `lib/actions/{competitions,fixtures,fixture-discovery}.ts`, the 4 football crons (`sync-fixtures`, `discover-competitions`, `process-competition-imports`, `refresh-recommendation-cache`), `admin/competitions|fixtures|fixture-archive/**`, `provider-status-panel` (+ drop its usage from `admin/settings`), provider/import tables + 3 import RPCs, and tests for exactly these modules. Update admin nav so no dead links remain.
- **TEMPORARILY RETAINED (deferred to Phase 4/5, NOT a design choice):** `lib/sports-data/**` (incl. `api-football-provider`, `provider-gateway`, `status-map`, `types.ts`, `supported-competitions`), `lib/actions/odds.ts`, `lib/actions/squads.ts`, `fixture_odds_cache`, `API_FOOTBALL_*` — all still imported by the KEEP pool‑creation core (`pools.ts`→`odds.ts`), the Phase‑4 wizard, and the grading types.
- **DB impact:** subtraction‑only migration dropping the confirmed‑unused provider/import tables (`provider_request_log`, `league_season_imports`, `competition_import_jobs`, `competition_import_job_chunks`, `competition_availability_cache`, `fixture_date_search_cache`) + 3 import RPCs. **Not** `fixture_odds_cache` (still written by retained `odds.ts`); **not** `fixtures`/`teams`/`leagues`.
- **App impact:** delete the removed modules and their call sites in one set; edit `admin/settings/page.tsx` to drop the provider‑status section; adjust admin nav. No pool‑creation/grading/wallet edits.
- **Tests:** remove only tests for the removed modules; keep tests for retained provider‑dependent modules (`api-football-provider`, `status-map`, `http`, `timezone`, provider‑gateway) and all pool/grading/settlement/wallet/security tests.
- **Manual verification:** app boots; feed + pool cards render; pool‑creation route compiles; grading compiles; `lock-pools`/`process-results` unaffected.
- **Protected untouched:** all money RPCs, `wallet_*`, privilege model, pool creation/grading business logic.
- **Stop conditions:** any removal would force an edit to pool creation/grading/settlement/wallet/security or a retained bridge module → STOP and report rather than expand scope.
- **Completion:** TypeScript + lint + unit + integration + build green; provider *operations/admin* gone; retained bridge modules still compile; no dead admin links/cron refs; no remaining import points to a deleted module.
- **Rollback:** deletion‑only + one subtraction migration — "don't merge," and the migration is a fresh additive file (revert by deleting it before apply).

### Phase 2 — Racing domain schema (additive)
- **Objective:** add `competitors`, `racing_competitions` (no `organizer_id`), `competition_stages` (incl. nullable `advancement_rule`), `races`, `race_competitors` (incl. the nullable progression‑slot fields `source_race_id`/`source_rule`/`source_position`/`is_placeholder`), `race_results`, `race_result_positions`; adapt `pools`/`pool_options` **additively** (add `race_id` nullable FK, relax `pools.fixture_id` to nullable, add `pool_options.competitor_id` nullable FK).
- **Why now:** foundation everything else builds on; additive so football code still compiles. Laying the progression‑slot fields now (unused until Phase 8) avoids a later schema rewrite for automatic advancement.
- **DB impact:** new tables + indexes (per report); two relaxing/additive changes to generic tables; RLS mirrors `fixtures` posture.
- **App impact:** none yet (schema only).
- **Tests:** schema/FK/RLS existence tests; N‑option `pool_options` insert test.
- **Protected untouched:** `entries`, `settlements`, `settlement_payouts`, `wallet_*` — no column changes.
- **Stop conditions:** any need to change a settlement table's shape.
- **Completion:** migrations apply cleanly on a fresh DB; tests green.
- **Rollback:** additive migrations revert cleanly; the `fixture_id` relax is its own migration.

### Phase 3 — Organizer role & many‑to‑many authorization
- **Objective:** add `'organizer'` enum value; create the **`competition_organizers`** many‑to‑many join table (`competition_id`, `organizer_id`, `assigned_by`, `assigned_at`); add a purpose‑built `requireOrganizerOrAbove()` coarse gate + a reusable per‑resource assignment check (`is_super_admin OR EXISTS(competition_organizers …)`, **never** `is_admin_or_above`); Super‑Admin assignment management (assign/reassign/unassign one‑or‑more organizers per competition).
- **Legacy‑`admin` audit (required deliverable):** enumerate every `requireAdminOrAbove()` / `is_admin_or_above` call site in the baseline and classify each in a short table committed with this phase — **(a)** re‑point to `requireSuperAdmin()` (global/money/account/audit authority), **(b)** re‑point to the assignment‑based organizer check (scoped racing management), or **(c)** retire with its route. `admin` is documented as **LEGACY TECHNICAL ROLE — NO NEW PRODUCT USE**; it grants no global authority and never bypasses assignments.
- **Why now:** every subsequent creation/result action needs the guard + assignment check, and the audit must land before any racing flow reuses an inherited guard.
- **DB impact:** one enum‑add (single‑statement); one new join table (service‑role‑write RLS). No `organizer_id` column anywhere.
- **App impact:** new guard + assignment‑check helper in `lib/auth`; assignment admin surface; the audited `requireAdminOrAbove()` call sites adapted/retired per the classification.
- **Tests:** organizer authorized on an assigned competition; **negative** — organizer denied on an unassigned competition; wrong‑role/unauthenticated rejected; multi‑assignment (one organizer on two competitions; two organizers on one competition); Super‑Admin bypass; **legacy `admin` (no assignment) denied on every racing competition** (proves `admin` ≠ `super_admin` and does not bypass assignments).
- **Protected untouched:** `is_super_admin`/`is_admin_or_above` bodies are not modified; the transitional `admin` role is neither widened nor granted racing authority — call sites are re‑pointed, the helpers themselves are left intact.
- **Stop conditions:** any organizer flow that would require broadening an RPC to `authenticated`, or that would let a user inherit global or racing authority through the legacy `admin` role, or that would enforce assignment via a widened grant rather than the Server‑Action check — **STOP and review.**
- **Completion:** guard + assignment CRUD + the legacy‑`admin` audit table + all authz tests (incl. the negative cross‑competition and legacy‑`admin`‑denied cases) green; enum name finalized (one‑way door).
- **Rollback:** join table + helper revertable; enum value is permanent — name locked before merge.

### Phase 4 — Single Race creation (first‑class)
- **Objective:** Server Actions + UI for competitors (persistent/race‑only, colors/number/image), races (N competitors, schedule/lock), and a race‑backed pool via the existing pool‑creation core; **minimal** N‑competitor pool header for rendering.
- **Why now:** delivers the simplest end‑to‑end object (a race) the rest depends on; keeps Single Race genuinely simple.
- **DB impact:** none new (uses Phase 2 tables).
- **App impact:** new admin/organizer creation surface; replace `MatchIdentity` with a minimal race header; pool creation gains a race‑picker path (fixture path untouched for now).
- **Football bridge removal (deferred from Phase 1 — do here once the racing pool‑creation path replaces the fixture wizard):** remove `lib/actions/odds.ts`, `lib/actions/squads.ts`, the provider‑dependent wizard steps in `admin/pools/new/*`, `lib/sports-data/api-football-provider.ts` + provider‑gateway/status-map/sync/persist/http/timezone/supported-competitions/events, the `fixture_odds_cache` table, and `API_FOOTBALL_*` env — **after** confirming the racing creation path no longer imports them. Sever `pools.ts`→`odds.ts` (drop the best‑effort odds fetch or replace with a racing‑neutral source) as part of this.
- **Tests:** N‑competitor race (2/3/5+), competitor identity validation, persistent vs race‑only + promotion; remove the retained provider/odds/squad tests as their subjects are removed.
- **Protected untouched:** pool‑creation core (`entry_fee`/`house_fee_bps`/audit/notification) — only input source changes.
- **Stop conditions:** the creation path needs a settlement/wallet change.
- **Completion:** an organizer creates competitors + a race + a Race Winner pool; it renders; the provider bridge (odds/squads/provider client/`API_FOOTBALL_*`) is gone.
- **Rollback:** feature‑flag the new creation route; additive.

### Phase 5 — Race Winner template + grading adapter
- **Objective:** Race Winner template body + `gradeRacePool()` (match `pool_options.competitor_id` to `race_results.winner_competitor_id`) terminating in unchanged `prepare_pool_settlement_manual`/`confirm_pool_settlement`.
- **Why now:** needs races/pools (P4); precedes result entry.
- **DB impact:** possibly one new `service_role`‑only grading RPC (if not pure TS) — added to `PROTECTED_RPCS`.
- **App impact:** new grading pathway alongside (not replacing) `gradeTemplatePool`.
- **Grading‑types bridge removal (deferred from Phase 1):** once the racing result model exists, relocate/replace the `FixtureInternalStatus`/`NormalizedFixture` types the grading path imports from `lib/sports-data/types.ts`, then remove `types.ts` — no early extraction/renaming for cleanliness (avoid churn) until this racing replacement is wired.
- **Tests:** winner‑only and full‑order grading resolves the correct option; writes evidence.
- **Protected untouched:** the registry `getTemplate`/`getLatestTemplate` mechanism; all money RPCs.
- **Stop conditions:** grading requires editing a money RPC.
- **Completion:** given a confirmed winner, the adapter selects the right option and calls the settlement RPC in a test harness.
- **Rollback:** additive module; not yet wired to a live trigger.

### Phase 6 — Result entry → grading → settlement + corrections
- **Objective:** organizer result‑entry + confirmation Server Action; event‑triggered grading on confirm; adapt `process-results` to a reconciliation safety net; manual‑review routing (`RACE_RESULT_UNRESOLVABLE`); super‑admin correction via `reverse_pool_settlement`/`undo_pool_grading`. The confirm action ends with a **progression hook** — a no‑op for Single Race / Championship (no downstream slots), and the extension point the Phase 8 automatic‑progression engine plugs into.
- **Why now:** closes the core money loop end‑to‑end. **This phase produces the first complete Single Race → Prediction → Result → Settlement loop.**
- **DB impact:** possibly `pool_review_reason` enum value add; no settlement changes.
- **App impact:** result UI, confirmation flow, correction UI (super‑admin).
- **Tests:** end‑to‑end confirm→grade→settle; everybody‑wins refund; nobody‑wins refund; ambiguous→manual review; correction/reversal after settlement.
- **Protected untouched:** `confirm_pool_settlement`/`confirm_pool_refund`/`reverse_pool_settlement` — interface only.
- **Stop conditions:** correct ordering can't keep wallet + result consistent without new money logic.
- **Completion:** a full race lifecycle moves money correctly and reverses correctly.
- **Rollback:** disable the confirm trigger; reconciliation cron off.

### Phase 7 — Championship/League standings + Competition Winner  — **V1 LAUNCH GATE**
- **Objective:** live standings from `race_results` via `points_config`; Competition Winner template + grading (final standings → winning option); tie‑that‑prevents‑a‑winner → manual review.
- **Why now:** completes V1 format scope.
- **DB impact:** none (computed) beyond `points_config` usage.
- **App impact:** standings views; Competition Winner creation/grading.
- **Tests:** standings correctness across multiple races; Competition Winner grading; ambiguous standings → manual review.
- **Protected untouched:** money code (standings are read‑only).
- **Stop conditions:** standings need a stored second‑source table with its own consistency guarantees.
- **Completion:** a multi‑race championship computes a winner and settles a Competition Winner pool. **→ V1 is functionally complete here.**
- **Rollback:** additive templates/views.

### Phase 8 — Knockout / Elimination automatic progression (post‑V1)
- **Objective:** the **automatic, result‑derived progression engine** with the **correction safe‑mutation boundary**. Bracket/elimination structure declared once as placeholder `race_competitors` slots (`source_race_id`/`source_rule`/`source_position`) and stage `advancement_rule`; the Phase 6 progression hook now, on a confirmed unambiguous result, auto‑fills downstream slots (winner → next slot; survivors → next stage). Ambiguous/tie/invalid‑state results **hold** for manual resolution. Corrections compute the downstream dependency chain and **auto‑rebuild only when nothing downstream is finalized** (not started, no confirmed result, no settled pool, no irreversible state); otherwise they **STOP → Super‑Admin review**, show the affected dependency chain before any reversal, and use the unchanged reversal machinery only where required — never a silent full‑tree cascade.
- **Why now:** needs the confirmed‑result loop (P6) and a hook to plug into; deliberately after V1 launch so cross‑race money cascades are introduced on a proven base.
- **DB impact:** none new (uses Phase 2 slot fields); possibly a `service_role`‑only progression RPC → added to `PROTECTED_RPCS`.
- **App impact:** progression engine in the confirm path; bracket‑builder UI (declare structure, not copy winners); manual‑resolution + Super‑Admin rebuild UI.
- **Tests:** deterministic advancement (QF→SF→Final auto‑fill); elimination survivors auto‑seed; ambiguous/tie **holds** (no auto‑fill); invalid‑progression‑state guard; and the **correction safe‑mutation boundary** — (1) correction **before** downstream race starts → automatic rebuild allowed; (2) correction after downstream race **scheduled but untouched** → automatic rebuild allowed; (3) correction after downstream **pool locks** → manual review; (4) correction after downstream **result confirmed** → manual review; (5) correction after downstream **settlement** → manual review; (6) correction affecting **multiple future stages** → dependency chain shown, **no silent cascade**.
- **Protected untouched:** all money RPCs — the boundary/rebuild only **calls** `reverse_pool_settlement`/`undo_pool_grading`/`confirm_pool_settlement`, never edits them.
- **Stop conditions:** auto‑progression would fire on an ambiguous or corrected‑pending result; a correction would auto‑propagate across any **finalized** downstream state (started/locked‑with‑entries/confirmed/settled) instead of routing to Super‑Admin review; the rebuild cannot keep wallet/standings/bracket consistent without new money logic.
- **Completion:** a full bracket + an elimination competition run end‑to‑end with automatic advancement; a correction with nothing downstream finalized auto‑rebuilds safely; a correction with finalized downstream state stops at Super‑Admin review showing the dependency chain. **Rollback:** progression engine is additive and gated behind the confirm hook; disabling the hook reverts to hold‑for‑manual.

### Phase 9 — Mixed‑stage competitions (post‑V1)
- **Objective:** compose `GROUP → KNOCKOUT → …` stage sequences under one competition.
- **Tests:** mixed traversal (Group → Knockout).
- **Completion:** a mixed competition runs across stage types. **Rollback:** additive.

### Phase 10 — Full player UX adaptation
- **Objective:** polish the N‑competitor header/`PoolLeagueHeader`; swap feed & search data sources to races/competitions; rename follows to `competitor_follows`/`competition_follows`; rewrite the rules page.
- **Why now:** needs real races/pools (P4–P7) to render against.
- **Tests:** N‑competitor card rendering (2/3/5+); competitor‑follow toggle; search retargeting.
- **Protected untouched:** `PoolOptionButton`/`PoolDistributionBar`/`AvatarStack`/comments/wallet/design system.
- **Completion:** the player surface is fully racing‑native. **Rollback:** per‑surface, additive.

### Phase 11 — Football core subtraction cleanup
- **Objective:** now that nothing references them — drop `fixtures`/`teams`/`leagues`/`team_players`/`*_follows`, view `fixtures_available_for_pool_creation`, legacy `prepare_pool_settlement`, `pools.fixture_id` column, `WHO_WILL_ADVANCE`/`REGULATION_RESULT`, remaining football tests; rewrite seed scripts.
- **Why now (not earlier):** these were load‑bearing until Phases 4–10 replaced every call site.
- **DB impact:** destructive drops, each isolated + individually revertable.
- **Stop conditions:** any remaining import of a to‑be‑dropped symbol; any KEEP‑test referencing it.
- **Completion:** no football table/column/RPC/test remains; suite green. **Rollback:** each drop is its own migration.

### Phase 12 — Admin/Organizer UX simplification + branding
- **Objective:** streamline organizer flows; controlled `brohda`→racing brand/copy sweep (~44 string occurrences, mechanical); `FROM_ADDRESS`/logo; rules/legal copy.
- **Why now:** branding is deliberately last (per the brief) — after the domain conversion is stable.
- **Tests:** snapshot/UX; no behavioral change.
- **Completion:** brand‑neutral internal name replaced with the chosen brand. **Rollback:** copy‑only.

### Phase 13 — Full racing launch verification
- **Objective:** run the complete NEW‑tests list; migration audit; **re‑verify RPC privilege boundary**; production smoke test on the isolated stack (mirroring the brohda release‑runbook rigor).
- **Completion:** all gates green on the isolated Supabase/Vercel project. **Rollback:** hold launch.

---

## Cross‑Phase Stop Conditions

STOP and report (do not improvise) if, in any phase:
- a change requires editing a Protected‑Core money RPC or ledger/audit table;
- a new capability is about to be granted to `authenticated`/`anon`/`PUBLIC`, or a role‑check is about to be added *inside* a generic RPC;
- any organizer flow would broaden an RPC to `authenticated`, or would let a user inherit global or racing authority through the **legacy `admin`** role (racing authz must be `is_super_admin OR competition_organizers` assignment, never `is_admin_or_above`);
- a KEEP‑UNCHANGED test (especially `rpc-privilege-boundary`, `settlement-logic`, `reversal`) goes red;
- an organizer could reach another organizer's competition/race/competitor/result;
- grading would auto‑settle an ambiguous/tie/DSQ result instead of routing to manual review;
- automatic progression would fire on an ambiguous, tied, or correction‑pending result instead of holding for manual resolution;
- a correction could leave wallet, standings, or bracket progression inconsistent; a downstream stage was auto‑populated before its source result settled; or a correction would auto‑propagate across **finalized** downstream state (started / locked‑with‑real‑entries / confirmed result / settled pool / advancement already used downstream) instead of stopping for Super‑Admin review with the dependency chain shown;
- the clone gains a `brohda.git` remote or a Supabase/Vercel link to Brohda;
- a "clean early delete" of football would break pool creation, feed, or grading before racing replaces it.

---

## Known Risks

| Risk | Sev | Likelihood | Mitigation |
|---|---|---|---|
| Editing money RPCs while building the grading adapter | HIGH | MED | Treat those files as frozen; adapter terminates in unmodified RPC calls; STOP gate |
| Widening an RPC grant to `authenticated` for organizer convenience | HIGH | MED | Server Actions + `service_role` only; every new RPC in `PROTECTED_RPCS` |
| A 4th undiscovered "exactly‑2" assumption | MED | MED | Build/test with a **5+‑competitor** race from Phase 4 |
| Correction after settlement moving money wrongly | HIGH | LOW | Reuse `reverse_pool_settlement` dry‑run‑then‑commit unchanged |
| Ties/DNF/DSQ ungraded indefinitely | MED | MED | Route to `MANUAL_REVIEW` / `RACE_RESULT_UNRESOLVABLE`; no new payout engine |
| Deleting football core too early destabilizes the app | MED | LOW | Split subtraction (P1 ingestion, P11 core after call‑site replacement) |
| Re‑introducing RPC‑grant drift in hand‑authored migrations | MED | LOW | Start from `brohda-rc1`'s corrected grant patterns; keep migration history (Strategy A) |
| Automatic progression firing on an ambiguous/tie/pending result | HIGH | MED | Progression **holds** unless the result is deterministic and unambiguous; else placeholder stays + manual‑resolution prompt (Phase 8 gate) |
| Correction blindly rewriting finalized downstream competition history / moving money wrongly | HIGH | MED | **Safe‑mutation boundary**: auto‑rebuild only when nothing downstream is finalized; any started/locked‑with‑entries/confirmed/settled downstream state → **STOP, show dependency chain, Super‑Admin review** using unchanged reversal machinery; never a silent full‑tree cascade (Phase 8) |
| Legacy `admin` inheriting global or racing authority | HIGH | LOW | `admin` classified LEGACY TECHNICAL ROLE — no new users; racing authz is `is_super_admin OR competition_organizers`, never `is_admin_or_above`; every inherited `requireAdminOrAbove()` call site audited in Phase 3; stop‑condition + test for `admin`‑without‑assignment denial |

---

## Open Questions

Resolved with recommended defaults (per the brief — defaults chosen; only genuine, materially‑impactful decisions surfaced):

Items 1, 2, and 5 are now **fixed by founder decision** (recorded here for traceability); the rest carry recommended defaults.

| # | Question | Resolution |
|---|---|---|
| 1 | Organizer↔competition cardinality | **FOUNDER‑FIXED: many‑to‑many** (`competition_organizers`). Super Admin assigns one‑or‑more organizers per competition; an organizer may hold one‑or‑more competitions. Reassign/unassign allowed. |
| 2 | Organizer's place in the role model | **FOUNDER‑FIXED: target roles are Super Admin / Organizer / Player.** Inherited `admin` is a **LEGACY TECHNICAL ROLE — NO NEW PRODUCT USE**: it does **not** imply Super Admin authority and does **not** bypass `competition_organizers` assignments; `super_admin` is the only global privileged role; no new `admin` users; every `requireAdminOrAbove()` call site is audited in Phase 3. |
| 3 | Invite directly as organizer? | **No** — promotion‑only (Super Admin promotes a player). |
| 4 | Points/standings formula | **FOUNDER‑APPROVED preset: 1st=10, 2nd=6, 3rd=4, 4th=3, 5th=2, 6th=1**, stored in `points_config`, **configurable per competition**; no rules engine, no tiebreaker engine. Standings tie that prevents an unambiguous Competition Winner → **manual review**. |
| 5 | Knockout/elimination advancement | **FOUNDER‑FIXED: automatic when deterministic & unambiguous.** Manual reserved for ambiguous/corrected/tie/invalid‑state + Super‑Admin rebuild. Organizers never copy winners forward. |
| 6 | Tie/dead‑heat Race Winner | **No auto‑settle** — exactly one unambiguous winner required; otherwise manual review; no split‑payout engine. |
| 7 | DSQ/DNF | Recorded as `finish_status` **metadata/status only**; no special payout mechanics in V1. Race Winner grades off the single confirmed winner; ambiguity → manual review. |
| 8 | Rerun | **New `races`/result event** (optional `original_race_id` link) — never silently overwrite historical truth; if original settled, reverse then fresh pool. |
| 9 | Podium/H2H | **Deferred**; when built, require full finishing order. |
| 10 | Racing odds source | **None** — organizer/admin set entry/house fee manually; football odds math stays dormant. |

All ten now carry a recorded decision or a founder‑approved default; **no open founder decision materially blocks implementation.** (Sign‑off is only *nice to have* on the exact `points_config` preset values — the approved numbers above are already applied.)

---

## Definition of Racing V1 Complete

- ✅ Isolated repo + separate Supabase/Vercel; no Brohda coupling.
- ✅ External football ingestion removed; app builds; KEEP‑tests green.
- ✅ Racing schema live (competitors, competitions, stages, races, results).
- ✅ Organizer role with **many‑to‑many, assignment‑scoped** authorization (`competition_organizers`); negative cross‑competition test green; multi‑assignment tested.
- ✅ Single Race is a simple, first‑class flow (create → competitors → schedule/lock → Race Winner pool → publish → run → enter/confirm winner → auto‑grade → auto‑settle).
- ✅ Race Winner **and** Competition Winner templates grade correctly (winner‑only and full‑order).
- ✅ Championship/League standings compute a winner; Competition Winner settles from it.
- ✅ Result confirmation event‑triggers grading→settlement; reconciliation cron as safety net.
- ✅ Everybody‑wins / nobody‑wins refunds (no fee) and correction/reversal all pass.
- ✅ Ambiguous results route to manual review; nothing auto‑settles a tie/DSQ.
- ✅ Player surface renders N‑competitor pools; social/wallet/leaderboard preserved.
- ✅ Protected Core unchanged; `rpc-privilege-boundary` green; every new RPC in `PROTECTED_RPCS`.

(Knockout/Elimination/Mixed formats — with their automatic result‑derived progression engine — plus full football‑core cleanup + branding are post‑V1 phases 8–12; the Phase 2 schema already carries the progression‑slot fields and the `competition_organizers` model, so none of these force a later rewrite.)

---

## Final Recommendation

**Proceed.** Clone `brohda-rc1`, subtract football, add a well‑scoped racing domain behind the already‑generic settlement engine. The evidence — verified directly against the baseline, not taken on faith — supports it: the settlement/wallet engine and RPC security model are domain‑agnostic and intact, the football surface is concentrated and cleanly separable, and the two‑sided assumption is a thin band of application code, not a database or settlement constraint.

Build in the narrow, independently testable phases above, remove football in dependency‑safe order (ingestion early, core late), and hold the Protected Core frozen behind explicit STOP/REVIEW gates. V1 is functionally complete at Phase 7; everything past it is additive.

**This is a racing product reusing a proven wallet, settlement, social, and security foundation — not a generic platform wearing a racing skin.**

---

*Awaiting approval. No Phase 1 work, application edits, migrations, football deletion, or deployment will begin until you approve.*
