# Racing Clone Architecture Report

**Scope:** read-only investigation. No application code, migrations, dependencies, or configuration were modified to produce this report. Baseline: `brohda-rc1` (commit `595702c`, tag pushed to `origin`), the current production-deployed state at `https://brohda.com`.

**Evidence standard:** every architectural claim below is backed by a specific file path, table name, migration filename, function/RPC name, or test filename. Where the repository doesn't provide enough evidence to make a safe call, this report says `UNKNOWN — REQUIRES DECISION` rather than guessing.

---

# Executive Summary

Brohda is two products stitched together at the schema level: a **generic prediction-pool/social/wallet platform** (auth, follows, comments, notifications, leaderboard, wallet ledger, settlement engine, admin/security infrastructure) and a **football-specific data-and-grading layer** (API-Football provider client, fixture/team/league import machinery, football scoring templates). These two halves are more separable than a first glance at the codebase suggests, because the settlement/wallet engine — the most safety-critical, hardest-won part of Phases 1–9 — was already built to be domain-agnostic: `apply_wallet_transaction`, `confirm_pool_settlement`, `confirm_pool_refund`, `prepare_pool_settlement_manual`, `reverse_pool_settlement`, and `undo_pool_grading` all operate on `pool_id`/`option_id`/`entry_id`/amounts, with zero references to team names, scores, or fixtures anywhere in their SQL bodies.

The football-specific surface is real but narrower than "half the codebase": it is concentrated in ~13 database tables (fixtures, teams, leagues, and the competition-import machinery), one legacy settlement RPC (`prepare_pool_settlement`), 17 template bodies plus their registry content (not the registry mechanism itself), a handful of admin routes (`admin/competitions/*`, `admin/fixtures`), one cron job (`sync-fixtures`), and two UI components with a hardcoded two-sided layout (`MatchIdentity`, and `pool_options`' generation logic in `lib/pools/templates.ts`).

**Recommendation: cloning `brohda-rc1` is the correct strategy.** A rough estimate — reasoned from the database/test/route inventories below, not a precise count — is that **60–70% of the codebase by file count and a substantially higher share by engineering effort (the wallet/settlement/security hardening) survives unchanged or with light adaptation.** The clean subtraction boundary (provider client, fixture/competition tables and cron, football template bodies, competition admin UI) is unusually well-isolated for a codebase that wasn't originally designed with a second sport in mind — largely because `fixtures.sport` was already a free-text column from day one (`supabase/migrations/20260101000008_fixtures.sql`), and because the settlement engine's own hardening work (idempotency keys, row locks, append-only ledger) never leaked football concepts into its interface.

The two things that must NOT be casually touched during this clone are exactly the two things Phases 1–9 fought hardest to get right: **the settlement/wallet engine** and **the RPC privilege security model** fixed in the incident response that immediately preceded this report. Both are addressed explicitly in their own sections below with concrete "do not touch" boundaries.

---

# Current Brohda Architecture

At a high level, three layers:

1. **Provider/data layer** — `lib/sports-data/` (API-Football client, HTTP retry/circuit-breaker, status normalization) + `lib/competitions/` (competition/season import orchestration, chunked job processing, discovery/availability caching). Feeds the `fixtures`, `teams`, `leagues`, `league_season_imports`, `competition_import_jobs(+chunks)`, `competition_availability_cache`, `fixture_date_search_cache`, `fixture_odds_cache`, `provider_request_log` tables.
2. **Pool/prediction engine** — `lib/pools/` (template registry, grading, view models), `lib/actions/pools.ts` (creation), and a set of `SECURITY DEFINER` Postgres functions (`prepare_pool_settlement[_manual]`, `confirm_pool_settlement`, `confirm_pool_refund`, `reverse_pool_settlement`, `abort_pool_reversal`, `undo_pool_grading`, `apply_wallet_transaction`) that own `pools`, `pool_options`, `entries`, `settlements`, `settlement_payouts`, `wallet_balances`, `wallet_transactions`.
3. **Consumer product shell** — auth/profiles/roles (`user_profiles`, `is_super_admin`/`is_admin_or_above`), social graph (`follows`, `pool_comments`, `pool_likes`, `notifications`), leaderboard (`correct_prediction_log`, `get_leaderboard`), wallet UI (`app/(app)/wallet/`), admin console (`app/(admin)/admin/*`), and the design system (`components/ui/`).

Layer 1 exists solely to keep layer 2 fed with fixture data. Layer 3 is almost entirely sport-agnostic already. Layer 2 is the hinge: its *plumbing* (RPCs, idempotency, view models, notifications) is generic; its *content* (template bodies, the legacy `WHO_WILL_ADVANCE`/`REGULATION_RESULT` SQL grading) is football-specific.

---

# Current Football Lifecycle

Verified against the code (not assumed):

```
API-Football (lib/sports-data/api-football-provider.ts)
  ↓ (fetchWithRetry, lib/sports-data/http.ts — logs every call to provider_request_log)
competition/season configuration (lib/sports-data/supported-competitions.ts — static allowlist)
  ↓
league_season_imports + competition_import_jobs/_chunks (lib/competitions/import-chunks.ts, process-chunk.ts)
  ↓ (cron: /api/cron/process-competition-imports, /api/cron/discover-competitions)
fixtures / teams / leagues (lib/sports-data/persist.ts — upsert on conflict)
  ↓ (cron: /api/cron/sync-fixtures — per-fixture adaptive refresh interval)
pool creation (lib/actions/pools.ts: createPoolForFixture / createPoolsForFixturesAction)
  ↓
pool template (lib/pools/templates.ts for WHO_WILL_ADVANCE/REGULATION_RESULT;
                lib/pools/templates/registry.ts for the 17 TEMPLATE_GRADED templates)
  ↓
pool_options (hardcoded 2 or 3 rows per pool — see Football Dependency Map)
  ↓
entries (create_pool_entry RPC — fully generic)
  ↓ (cron: /api/cron/lock-pools — generic, status-driven, no fixture knowledge)
fixture result (fixtures.regulation_home_score/away_score etc, written by sync-fixtures)
  ↓ (cron: /api/cron/process-results)
grading — TWO DIFFERENT PATHS, verified from code:
  (a) legacy pool_type WHO_WILL_ADVANCE/REGULATION_RESULT → graded entirely inside the
      SQL function prepare_pool_settlement (supabase/migrations/20260101000010_settlements.sql),
      which reads fixtures directly.
  (b) TEMPLATE_GRADED pools → graded in application code, lib/pools/templates/grade.ts's
      gradeTemplatePool(), which calls template.gradingRule() against fixture scores, then
      calls the *generic* RPC prepare_pool_settlement_manual (no fixture read inside SQL at all).
  ↓
settlement/refund (confirm_pool_settlement / confirm_pool_refund — fully generic RPCs)
  ↓
wallet (apply_wallet_transaction — the single money-movement chokepoint, fully generic)
  ↓
notification/activity/leaderboard (lib/notifications/create.ts, correct_prediction_log —
  fully generic, reads pool_options.label and entries.status, never team names/scores)
```

**Where the assumed lifecycle in the task brief differs from the actual implementation:** grading is not one path, it's two (legacy SQL-side vs. template-registry application-side), and only the legacy path (`prepare_pool_settlement`) reads `fixtures` from inside a database function — the newer, actively-used `TEMPLATE_GRADED` path already funnels through the fully generic `prepare_pool_settlement_manual`, meaning **most of today's actual settlement traffic never touches a football-aware RPC at all.** This is a materially better starting position for a racing clone than "grading is deeply embedded in SQL."

---

# Football Dependency Map

Grounded in the parallel research streams (file paths as reported by each). Organized by area:

- **Provider client**: `lib/sports-data/api-football-provider.ts` (884 lines, the `ApiFootballProvider` singleton), `lib/sports-data/http.ts` (`fetchWithRetry`, generic retry/backoff but the sole caller is the football provider), `lib/sports-data/status-map.ts` (`CODE_MAP` translating API-Football's `NS/1H/2H/HT/ET/PEN/FT/...` codes), `lib/sports-data/provider-gateway.ts` (`isQuotaExhaustedError`, `getProviderStatus`, `CIRCUIT_BREAKER_COOLDOWN_MS`).
- **Provider quota/circuit breaker**: `provider_request_log` table (`supabase/migrations/20260101000008_fixtures.sql`), read/written exclusively for `provider = "api_football"`.
- **Competition/season config**: `lib/sports-data/supported-competitions.ts` (`SUPPORTED_COMPETITIONS`, 14 hardcoded league entries), `league_season_imports`, `competition_import_jobs`, `competition_import_job_chunks`, `competition_availability_cache`, `fixture_date_search_cache` tables; `lib/competitions/*.ts` (import-chunks, process-chunk, process-imports-cron, discovery-sync, workspace-data, manager-data, status, availability-cache, badge-classes).
- **Fixture sync**: `app/api/cron/sync-fixtures/route.ts` → `lib/sports-data/sync.ts`'s `runFixtureSync()`; `app/api/cron/discover-competitions/route.ts`, `app/api/cron/process-competition-imports/route.ts`, `app/api/cron/refresh-recommendation-cache/route.ts`.
- **Fixture odds/cache**: `fixture_odds_cache` table, `lib/pools/templates/odds-mapping.ts`, `lib/pools/templates/odds-devig.ts` (math is domain-agnostic, callers are football-specific).
- **Match status/regulation result**: `fixture_internal_status` enum (`NOT_STARTED, LIVE, HALFTIME, EXTRA_TIME, PENALTIES, COMPLETED, POSTPONED, SUSPENDED, ABANDONED, CANCELLED, AWARDED, UNKNOWN`); `fixtures.regulation_home_score`/`regulation_away_score`/`extra_time_*`/`penalty_*`/`halftime_*`.
- **Football template registry**: `lib/pools/templates/registry.ts` (`TEMPLATE_REGISTRY`, 17 entries), `match-result.ts`, `goals.ts`, `match-events.ts`, `player-props.ts` — every `gradingRule` parses goals/scores.
- **Pool templates (legacy)**: `lib/pools/templates.ts`'s `generatePoolTemplate` — hardcodes exactly 2 options (`WHO_WILL_ADVANCE`) or exactly 3 (`REGULATION_RESULT`, incl. literal "Draw").
- **Grading evidence**: `pool_grading_evidence` table — generic shape, football-specific content (template_id references football templates).
- **process-results cron**: `app/api/cron/process-results/route.ts` (not deep-dived by name alone, but calls into `lib/pools/templates/grade.ts` and the legacy SQL path per settlement research).
- **Pool creation wizard**: `app/(admin)/admin/pools/new/pool-template-builder.tsx` (single-fixture) and `multi-fixture-builder.tsx` (bulk) — both require a `fixtureId`; `getTemplateEligibility(competitionType)` disables `WHO_WILL_ADVANCE` for League fixtures and `REGULATION_RESULT` for Cup fixtures.
- **Competition workspace**: `app/(admin)/admin/competitions/` — list page + `[id]` dashboard/health/synchronization/lifecycle (settings/templates now redirect stubs, folded into dashboard per the Phase 7 cleanup).
- **Fixture archive**: `app/(admin)/admin/fixture-archive/page.tsx` — redirect stub to `/admin/fixtures?archived=1`.
- **Cron jobs**: `sync-fixtures`, `discover-competitions`, `process-competition-imports`, `refresh-recommendation-cache` — all football-only. `lock-pools`, `process-results` are generic lifecycle jobs that happen to currently be fed by football data.
- **Admin pages**: `admin/competitions/*` (6 routes), `admin/fixtures` (3 modes), `admin/fixture-archive` — football-specific. `admin/settings`'s `provider-status-panel.tsx` — football-provider-specific widget inside an otherwise generic page.
- **Feed cards**: `components/pools/MatchIdentity.tsx` (hardcoded "VS" + exactly-2 `TeamBadge`s), `components/pools/PoolLeagueHeader.tsx` (competition name/logo + kickoff framing).
- **Pool cards**: `PoolOptionButton` loop over `pool_options` is already N-agnostic (no football dependency) — see Reuse/Adapt matrix.
- **Search**: `app/(app)/search/page.tsx`'s fixture-search branch (`.ilike()` on `fixtures.home_team_name`/`away_team_name`/`competition_name`), `lib/pools/templates/category-labels.ts`'s `AnalyticsCategoryCode` (`MATCH_RESULT, GOALS, TEAM_PROPS, PLAYER_PROPS, MATCH_STATS, DISCIPLINE`).
- **Profiles**: `app/(app)/profile/followed-teams-leagues-tab.tsx` — the one football-coupled profile section.
- **Leaderboard**: no football coupling found (`get_leaderboard` RPC is purely entry/settlement-based).
- **Notifications**: no football coupling found (generic notification types, `POOL_PUBLISHED_FOLLOWED` fires from team/league follows but the type itself is sport-agnostic).
- **Tests**: ~30 of 73 unit test files and ~10 of 36 integration test files are football-specific or football-adjacent (full list in Test Strategy).
- **Database FKs**: only `pools.fixture_id → fixtures.id`, `team_follows.team_id → teams.id`, `league_follows.league_id → leagues.id`, `league_season_imports.league_id → leagues.id` are real FK constraints into football tables. No `home_team_id`/`away_team_id` FK columns exist anywhere — team identity on `fixtures`/`pool_options` is denormalized **text** (`home_team_external_id`, `external_team_id`), matched by string comparison inside `prepare_pool_settlement`, not by relational join.
- **RPCs**: `prepare_pool_settlement` (football-specific), all others generic (see Settlement RPCs research).
- **Views**: `fixtures_available_for_pool_creation` (entirely football-specific), `pool_options_public` (generic gating mechanism, football-flavored columns exposed).
- **Indexes**: 13 indexes exist on fixture/team/league-related columns (full list in Database Current-to-Target Map).
- **Seed scripts**: `scripts/seed.ts` (10 demo pools, all built around fake football/multi-sport fixtures with named "teams"), `scripts/seed-dev-grading.ts` (1 hardcoded fixture/team pair to exercise the grading pipeline deterministically).
- **Environment variables**: `API_FOOTBALL_BASE_URL`, `API_FOOTBALL_KEY`, `API_FOOTBALL_ENABLED` — the entire football-specific env surface (confirmed via full `process.env` grep — no other football-tied variable exists).

A football dependency that does **not** exist under a generic-looking name, worth calling out explicitly: `wallet_transactions.fixture_label`/`competition_name` columns (added in `20260101000053`) are populated from football data today but are plain snapshotted **text** with domain-neutral names — they need no schema change for racing, only a different source string at write time.

---

# Reuse / Adapt / Remove / Replace Matrix

| Subsystem | Class | Why |
|---|---|---|
| Auth, sessions, roles (`user_profiles`, `is_super_admin`, `is_admin_or_above`, `lib/auth/*`) | **A — REUSE UNCHANGED** | Zero sport coupling. `requireSuperAdmin()`/`requireAdminOrAbove()` are pure role checks. |
| Invitations (`invitations` table, `lib/actions/invitations.ts`) | **A** | Generic invite-token flow; new-user role is hardcoded `'player'` at acceptance regardless of sport. |
| Wallet ledger (`wallet_balances`, `wallet_transactions`, `apply_wallet_transaction`) | **A** | Zero football references anywhere in schema or RPC body (verified by direct read of the RPC in this session's own incident work, cross-checked by the pool/settlement research stream). |
| Wallet requests & payment methods (`wallet_requests`, `payment_methods`, `DepositFields.tsx`) | **A** | Payment-method model (USDC/USDT/Venmo/Cashapp/Zelle/Other) has no sport concept anywhere. |
| Settlement RPCs: `confirm_pool_settlement`, `confirm_pool_refund`, `confirm_combo_refund_fee_retained`, `prepare_pool_settlement_manual`, `reverse_pool_settlement` (except its fixture-branch), `abort_pool_reversal`, `undo_pool_grading` | **A** | Operate only on `pool_id`/`option_id`/`entry_id`/amounts. No team/score/fixture reference in any body. |
| Generic social: `follows`, `pool_likes`, `pool_comments`, `@mentions` | **A** | No sport coupling; `pool_id`-scoped only. |
| Notifications (`notifications` table, `lib/notifications/create.ts`, `lib/notifications/tiers.ts`) | **A** | Reads `pool_options.label`/`entries.status`/`settlement_payouts.amount`, never scores or team names. |
| Leaderboard (`get_leaderboard`, `correct_prediction_log`, `StreakWidget`) | **A** | Purely win-rate/streak math over `entries`/`user_profiles`. |
| Profile core (`ProfileHeader`, stats, pick history) | **A** | Bio/pronouns/gender/stats are sport-agnostic; only the "Following" sub-tab is coupled (see below). |
| Design system (`components/ui/*`, CVA + Tailwind tokens) | **A** | No domain copy in any primitive; `RulePill` takes a plain `label: string` prop. |
| Comments UI (`CommentSheet`, `MentionText`, `MentionInput`) | **A** | Pure `pool_id`-scoped, no sport concept. |
| Rate limiting, audit logging, CI, Playwright infra | **A** | `check_and_increment_rate_limit`, `audit_logs`, `.github/workflows/ci.yml`, `playwright.config.ts` are all domain-agnostic. |
| RPC privilege security model (migration `000107`, `rpc-privilege-boundary.test.ts`) | **A — MUST SURVIVE AS-IS** | The corrected grant model (service_role-only for mutations, authenticated+service_role for reads) is the load-bearing security boundary; see Security Model section. |
| `entries`, `settlement_payouts`, `create_pool_entry` RPC | **A** | Fully generic — `pool_id`/`option_id`/`amount`; no cardinality assumption. |
| `pools`, `pool_options` schema (not app-code option-generation logic) | **B — REUSE WITH ADAPTATION** | Schema itself has no cardinality constraint on `pool_options` rows (only a *partial* unique index scoped to `binary_outcome is not null` — see Database section) and already supports arbitrary N options. `pools.fixture_id` needs to become nullable-or-renamed to point at a new `race_id`; `pool_options`' denormalized `external_team_id`/`team_name` columns need to point at competitors instead of teams. |
| Design of `SocialPoolCard`/`PoolPreviewCard` container, `PoolOptionButton`, `PoolDistributionBar`, `AvatarStack` | **B** | Already render an arbitrary-length `options` array (`Array<{...}>` in `lib/pools/view-model.ts`) — no changes needed to the option-list rendering itself. |
| `PoolLeagueHeader` | **B** | Generic countdown/visibility-badge chrome; needs its "competition + kickoff" copy/data source swapped for "competition/race + start time," but the component shape survives. |
| Feed page (`app/(app)/feed/page.tsx`) | **B** | Fully generic query/rendering; only its join to `fixtures(sport, competition_name, ...)` needs to point at the new race/competition tables. |
| Pool template registry **mechanism** (`PoolTemplate` interface, `getTemplate`/`getLatestTemplate`, versioning) | **B** | Id/version resolution, Zod config validation, `questionBuilder`/`gradingRule` function shape, `YES/NO/VOID/PENDING` result contract — all domain-agnostic. Every concrete template *body* is football-specific and must be rewritten (see Template Model section) — the registry shell survives, its contents don't. |
| `gradeTemplatePool` orchestration (`lib/pools/templates/grade.ts`) | **B** | The function's control flow (resolve template → validate config → run gradingRule → resolve winning option → call `prepare_pool_settlement_manual` → write evidence → call `confirm_pool_settlement`) is generic; only its input type (`TemplateFixtureRow`) is football-shaped and needs a racing equivalent. |
| Search (`app/(app)/search/page.tsx`) | **B** | User-search branch is untouched; fixture-search branch needs to become race/competitor/competition search using the same `.ilike()` pattern against new tables. |
| Profile "Following" tab (`followed-teams-leagues-tab.tsx`) | **B** | Same toggle-follow pattern, needs to point at `competitor_follows`/`competition_follows` instead of `team_follows`/`league_follows`. |
| Admin `pools/*` pages (list, detail, publish/lifecycle actions) | **B** | Pool CRUD, settlement/void/reversal buttons are generic; only the *creation wizard's* fixture-selection step is football-specific. |
| Admin `reports`/`analytics` pages | **B** | Aggregate wallet/entry/settlement metrics; a small number of football-labeled report fields (if any) would need renaming, core queries survive. |
| `fixtures`, `provider_request_log`, `fixture_odds_cache`, `fixture_date_search_cache` | **C — REMOVE** | Exist solely to hold/cache API-Football data. No racing product responsibility maps onto their content. |
| `league_season_imports`, `competition_import_jobs`, `competition_import_job_chunks`, `competition_availability_cache` | **C — REMOVE** | Import/sync lifecycle machinery for an external provider racing does not have. |
| `lib/sports-data/*` (provider client, HTTP retry wrapper's football-specific caller, status-map, circuit breaker's quota-string matching) | **C — REMOVE** (the provider client itself); the generic `fetchWithRetry` HTTP wrapper in `http.ts` is reusable plumbing if a *future* racing data source ever needs it, but has no caller in V1 (racing results are organizer-entered, not provider-sourced) |
| `lib/competitions/*` import orchestration (import-chunks, process-chunk, process-imports-cron, discovery-sync, availability-cache) | **C — REMOVE** | No import job exists without an external provider to import from. |
| `sync-fixtures`, `discover-competitions`, `process-competition-imports`, `refresh-recommendation-cache` crons | **C — REMOVE** | No provider to sync/discover/refresh against. |
| `admin/competitions/*` (6 routes), `admin/fixtures` (3 modes), `admin/fixture-archive` | **C — REMOVE** | No provider-import workspace needed; racing's admin/organizer competition-management needs are structurally much simpler (see Admin/Organizer Experience section). |
| `teams`, `leagues`, `team_players` | **C — REMOVE**, product responsibility **REPLACED** by `competitors`/`racing_competitions` | Not a 1:1 schema port — racing competitors need per-race N-way membership and up-to-4-color identity that `teams`' provider/external_id/name/logo shape doesn't model. |
| `team_follows`, `league_follows` | **C — REMOVE**, product responsibility **REPLACED** by `competitor_follows`/`competition_follows` | Structurally identical pattern (idempotent toggle + email preference), new FK target. |
| Legacy `WHO_WILL_ADVANCE`/`REGULATION_RESULT` pool types and `prepare_pool_settlement` RPC's fixture-reading branches | **C — REMOVE** | The one settlement RPC that is football-specific; racing has no "advance in a knockout with extra time/penalties" or "regulation-time result" concept in this exact shape — see Race/Result Model for the actual racing equivalent. |
| 17 football template bodies (`match-result.ts`, `goals.ts`, `match-events.ts`, `player-props.ts`) | **D — REPLACE** | Product responsibility (predict an outcome of a competitive event) persists into racing; every concrete grading rule (goals/cards/player-scoring arithmetic) does not transfer and must be rewritten against race-result data. |
| `fixture_internal_status` enum, "match/fixture" result-source concept | **D — REPLACE** | Racing needs a much simpler status model (no extra-time/penalties/halftime) and an organizer-entered result instead of a provider-synced score. |
| `MatchIdentity.tsx`'s hardcoded 2-competitor "VS" layout | **D — REPLACE** | Racing needs an N-competitor-aware header component; the existing 2-sided layout cannot represent a field of racers. |
| Rules page (`app/(app)/rules/page.tsx`) | **D — REPLACE** | Entirely hardcoded football-specific prose (kickoff, extra time/penalties, cards, both-teams-to-score) — full rewrite, not adaptation. |
| `pool_void_reason`'s 6 `MATCH_*` values | **D — REPLACE** | Directly named after API-Football fixture statuses; racing needs analogous but differently-named anomaly reasons (race postponed/cancelled/abandoned/result-unknown). |
| Full bracket/knockout progression mechanics, standings computation for Championship/League formats | **E — INVESTIGATE FURTHER** | No existing Brohda concept resembles a multi-stage tournament bracket or points-standings table; this is genuinely new product surface, not adaptable from anything in the repo. See Competition Progression section. |
| Organizer-to-resource ownership/assignment model | **E — INVESTIGATE FURTHER** | No per-resource ownership pattern exists anywhere in the current schema (only a dormant, unused admin-hierarchy tree — `parent_admin_id`, `get_branch_member_ids()`, `20260101000063_admin_hierarchy.sql` — that models branch/tree structure, not resource assignment). A new pattern is needed; the repo doesn't tell us which shape is safest without a product decision. See Organizer Permission Model section. |

---

# Target Racing Domain

The task brief's hypothesis (`Competition → Stage → Race → Competitor → Result`) holds up well against the existing schema, with one important correction: **Brohda's existing schema already generalizes the "prediction pool" concept away from "exactly one fixture, exactly 2-3 options"** — `pool_options` has no cardinality constraint (§ Database section), and `entries`/`settlement`/`wallet` are entity-count-agnostic by construction. The actual gap is narrower than "rebuild the whole prediction model" — it's specifically:

1. A new **event-source hierarchy** (`racing_competitions` → `competition_stages` [optional] → `races` → `race_competitors` → `race_results`) to replace `fixtures`/`teams`/`leagues`/the import machinery.
2. A new **grading bridge** connecting `race_results` to `pools`/`pool_options`, replacing the football-specific parts of `prepare_pool_settlement`/`grade.ts`'s template bodies, while reusing `prepare_pool_settlement_manual`/`confirm_pool_settlement`/`confirm_pool_refund` completely unchanged.
3. A handful of **UI components** (`MatchIdentity`, `PoolLeagueHeader`, the pool-creation wizard's fixture-picker step) that assume exactly one fixture with two sides.

This is a smaller, better-isolated gap than "clone a generic sports platform" — it is closer to "swap one well-defined data source for another behind an already-generic settlement engine."

---

# Competitor Model

**Existing analog**: `teams` table (`provider`, `external_id`, `name not null`, `logo_url`) — deliberately minimal, built for provider-sourced football team reference data, unique on `(provider, external_id)`. Not reusable as-is: no color fields, no number field, `name not null` conflicts directly with the requirement that a competitor may be identified by number/colors alone with no conventional name, and the whole `provider`/`external_id` shape exists only to dedupe against a data feed racing doesn't have.

`user_profiles.avatar_url` (generic avatar-URL pattern, confirmed reusable per player-experience research) is the closer analog for competitor imagery — same "URL string, render with fallback" pattern already used throughout `components/pools/PoolOptionButton.tsx`/`MatchIdentity.tsx` for team logos.

**Recommendation** — a single `competitors` table, not a "team" rename:
- `id uuid pk`
- `name text` — **nullable**, per the "does not require a conventional name" requirement.
- `number text` — nullable (e.g. "#7"); text not integer, since racing numbers can carry non-numeric formatting.
- `colors text[]` — nullable array, max 4 enforced at the application/Zod layer (not a DB CHECK, to avoid over-constraining before the UI settles on exact input shape).
- `image_url text` — nullable, same pattern as `avatar_url`.
- `is_persistent boolean not null default true` — distinguishes library competitors from race-only ones (see below); a race-only competitor is simply a row with `is_persistent = false`, not a separate table.
- `created_by uuid references user_profiles(id)`, `organizer_id uuid references user_profiles(id)` — see Organizer Permission Model for whether these should be the same column.
- `is_active boolean not null default true` — soft-delete flag, following the same pattern as `user_profiles.is_active`/`fixtures.hidden_from_pool_creation`.
- `created_at`/`updated_at`.
- Constraint: at least one of `name`/`number`/`colors`/`image_url` must be non-null. **This is a business rule better enforced in the Zod schema and Server Action than as a DB CHECK across four nullable heterogeneous columns** — a CHECK is possible (`coalesce(name, number, array_to_string(colors,''), image_url) is not null` or similar) but brittle to maintain as fields evolve; recommend application-layer enforcement, consistent with how "at least one meaningful identifying attribute" reads as a UX rule, not a hard data-integrity rule.

The "save for future races" checkbox is just `is_persistent`. A race-only competitor still gets a permanent row (never a separate ephemeral structure) — this directly avoids the "race-only competitor later needing history" risk flagged in Risk Assessment: because it's the same table, a race-only competitor that later needs promotion to persistent status is a single `update ... set is_persistent = true`, not a data migration.

`race_competitors` (join table, see Race Model) is what actually links a competitor to a specific race — `competitors` itself carries no race-specific data (starting position, etc.), keeping the library/race-only distinction purely about *reuse*, not about race participation.

---

# Competition and Stage Model

No existing Brohda concept models a multi-stage tournament — `league_season_imports` is provider-import bookkeeping, not a competition-structure concept, and there is no "standings" or "bracket" table anywhere in the schema (confirmed by the full table enumeration in the Database research stream: 35 tables, none named anything like `standings`/`bracket`/`group`).

Recommended smallest model, directly answering the brief's Championship/League and Bracket/Sudden-Death sharing questions:

- **`racing_competitions`** — `id`, `name`, `format` (enum: `SINGLE_RACE | CHAMPIONSHIP | LEAGUE | BRACKET | ELIMINATION | MIXED`), `organizer_id`, `status`, `created_at`/`updated_at`. Dramatically simpler than `league_season_imports` — no `import_status`/`sync_status`/`coverage_snapshot`/fixture-count columns, because there is no external provider lifecycle to track. This alone is a strong signal the racing admin experience should feel much lighter than the football one (directly addresses the Admin Experience section's expectation).
- **`competition_stages`** — `id`, `competition_id`, `name`, `stage_type` (enum: `RACE | POINTS_STANDINGS | GROUP | KNOCKOUT` — per the brief's own hypothesis), `sequence_order int`, `status`. **Optional layer**: a `SINGLE_RACE`-format competition has zero stage rows and its one race references `competition_id` directly with `stage_id = null`; a `MIXED`-format competition (Group → Quarterfinal → Semifinal → Final) has one stage row per phase.

**Can Championship and League share one engine?** Yes, and the schema above already does this by design: both are just a `racing_competitions.format` value whose races are grouped under `stage_type = 'POINTS_STANDINGS'` stages (or no stages at all for a flat league). Standings are **not** a stored table — they should be computed at read time from `race_results` joined through `races → competition_stages/racing_competitions`, the same way today's leaderboard is computed live from `entries`/`correct_prediction_log` rather than maintained as a separately-updated table. This avoids a second source of truth needing its own consistency guarantees. `UNKNOWN — REQUIRES DECISION`: the exact points-per-position formula (F1-style, simple win-count, etc.) is a product decision this report cannot derive from the repository.

**Can Bracket and Sudden-Death share progression primitives?** Structurally yes — both are `stage_type = 'KNOCKOUT'` stages where a race's `winner_competitor_id` determines who advances to the next stage's `race_competitors` row. The *mechanics* of automatically populating the next stage's `race_competitors` from the previous stage's winners is genuinely new territory with no existing Brohda precedent (`UNKNOWN — REQUIRES DECISION` on whether this is automated or organizer-populated manually in V1 — see V1 Recommendation, where manual population is recommended to avoid building bracket-automation logic before it's proven needed).

This model avoids enum/template explosion: exactly one `stage_type` enum (4 values) and one `format` enum (6 values) cover every named structure in the brief, with the actual competitive logic (who's in this race, who won) living uniformly in `races`/`race_competitors`/`race_results` regardless of which format/stage type wraps them.

---

# Race Model

**Explicit assumption-check, per the brief's instruction**: the current two-sided model lives in exactly three places, all confirmed by the pool/template and player-experience research streams:
1. `lib/pools/templates.ts`'s `generatePoolTemplate` — hardcodes 2 options (`WHO_WILL_ADVANCE`) or 3 (`REGULATION_RESULT`, including a literal "Draw" option).
2. `lib/pools/templates/grade.ts`'s YES/NO option resolution (falls back to matching `label === "Yes"|"No"` for legacy rows) — assumes exactly a binary pair, not an N-way field.
3. `components/pools/MatchIdentity.tsx` — hardcodes a literal `"VS"` string and exactly two `TeamBadge` renders.

**Everywhere else — `pool_options` table, `entries` table, `PoolOptionButton`'s render loop, `PoolDistributionBar`, `create_pool_entry`/`confirm_pool_settlement`/`confirm_pool_refund` RPCs — is already N-agnostic.** This is the single most important finding for the whole racing clone: the hardcoded two/three-sided assumption is a thin band of *application* code, not a database or settlement-engine constraint.

**Recommended `races` table**, cross-referenced against `fixtures`' existing fields to show what's needed vs. droppable:

| Field | Racing need | Fixtures equivalent | Verdict |
|---|---|---|---|
| `competition_id` | yes, required | (none — fixtures have no competition FK, only denormalized text) | New, real FK (an improvement over fixtures' text-based coupling) |
| `stage_id` | yes, optional | (none) | New, nullable FK |
| `race_number`/`order` | yes | `round` (text, e.g. "Regular Season - 12") | New, simpler (integer or short label) |
| `competitors` | yes, N-way | `home_team_*`/`away_team_*` (exactly 2, denormalized text) | Replaced by `race_competitors` join table |
| `scheduled_start_utc` | yes | `scheduled_start_utc` | Direct port |
| `locks_at` | yes | (pools have their own `locks_at`, not fixtures) | Follows the existing `pools.locks_at` pattern, not a new fixtures-level concept |
| `status` | yes, simpler | `internal_status` (12-value football enum incl. HALFTIME/EXTRA_TIME/PENALTIES) | New, smaller enum: `SCHEDULED, IN_PROGRESS, COMPLETED, POSTPONED, CANCELLED, ABANDONED` |
| `winner_competitor_id` | yes, required once known | (fixtures have no winner column — winner is derived from scores at grading time) | New — racing computes/stores this explicitly rather than deriving it, since there's no score-based derivation available |
| `full finishing order` | yes, optional | (none) | New child table, `race_result_positions` (see Result Model) |
| `video/stream URL` | yes | (none) | New, simple nullable column |
| `organizer ownership` | yes | (fixtures have no owner — they're provider data) | New — see Organizer Permission Model |
| `audit info` | yes | `created_at`/`updated_at` | Direct port pattern |

Notably absent from the recommended `races` table, deliberately: `provider`, `external_id`, `provider_payload`, `sync_error`, `last_synced_at`, `hidden_from_pool_creation`, `provider_events_payload` — every column that exists on `fixtures` solely because of the provider-sync lifecycle. This is a **REPLACE**, not an **ADAPT**, of the fixtures table: a fresh, much smaller table is safer and clearer than trying to make one table serve both an external-provider-synced fixture and an organizer-entered race.

---

# Result Model

Verified separation in the current codebase (directly relevant to preserving it, per the brief's instruction):

- **Provider result** = `fixtures.regulation_home_score`/`away_score` etc., written only by `lib/sports-data/persist.ts` from `sync-fixtures`.
- **Grading evidence** = `pool_grading_evidence` table — append-only, one row per grading attempt, `{template_id, template_version, result, reason, evidence jsonb}`. Never mutated after insert (same `forbid_*_mutation` trigger pattern as `audit_logs`).
- **Winning option** = `pool_options.is_winning_option`, set only inside `confirm_pool_settlement`.
- **Settlement** = `settlements` row, `confirm_pool_settlement`/`confirm_pool_refund`.

This four-layer separation (raw result → evidence → winning option → settlement) is exactly the shape the brief asks to preserve, and it maps cleanly onto racing:

```
Organizer/Super Admin records race_results (winner required, full order optional)
  ↓
NEW racing-grading function resolves which pool_option's competitor_id
  matches race_results.winner_competitor_id (same pattern prepare_pool_settlement
  already uses today — matching pool_options against a real winning entity —
  just against race_results instead of fixtures, and via a real competitor_id
  FK instead of denormalized external_team_id text)
  ↓
writes pool_grading_evidence (UNCHANGED table, new evidence content: race_id,
  confirmed_by, race_result snapshot)
  ↓
calls prepare_pool_settlement_manual (UNCHANGED RPC — already generic)
  ↓
calls confirm_pool_settlement (UNCHANGED RPC — already generic)
```

**Recommended `race_results`/`race_result_positions` split**, to satisfy "winner required, full order optional" without a future redesign:

- **`race_results`**: `race_id` (unique), `winner_competitor_id not null references competitors(id)`, `confirmed_by uuid references user_profiles(id)`, `confirmed_at`, `status` (`PENDING_CONFIRMATION | CONFIRMED | CORRECTED`), `corrected_at`/`corrected_by`/`correction_reason` (nullable, for the audit trail — see Result Trust section), `created_at`.
- **`race_result_positions`** (child table, zero-to-many rows per race): `race_id`, `competitor_id`, `position` (nullable — supports "unknown" for a partial order), `finish_status` (enum: `FINISHED | DNF | DSQ | DID_NOT_START`, handling the disqualification/abandoned-race edge cases the brief flags). A winner-only result is exactly one `race_result_positions` row (the winner, position 1) plus the required `race_results.winner_competitor_id`; a full order is N rows. **No schema change is needed later to support "richer future prediction templates"** — Top 3/Top 2/exact-order templates all read the same table, just with different completeness expectations at grading time (and grade as `PENDING` if the rows they need aren't there yet — following the exact same "never coerce missing data" principle `gradeTemplatePool` already uses for fixture events).

This directly satisfies the brief's "store enough structured information... without requiring a future redesign" instruction while keeping V1 grading logic simple (only `race_results.winner_competitor_id` is required for the two V1 templates — see Prediction Template Model).

---

# Organizer Permission Model

**Current role model** (verified): `user_profiles.role` is a Postgres enum `user_role`, currently `super_admin | admin | player` (`admin` added via a dedicated single-statement migration, `20260101000020_admin_role.sql`, because Postgres requires a new enum value to be committed before it can be referenced). `is_super_admin(uid)`/`is_admin_or_above(uid)` SQL functions and `requireSuperAdmin()`/`requireAdminOrAbove()` Server-Action guards (`lib/auth/session.ts`) are the enforcement points. **No per-resource ownership/assignment model exists anywhere in the schema today** — the closest primitive is a dormant admin-hierarchy tree (`user_profiles.parent_admin_id`, `get_branch_member_ids()`, `would_create_hierarchy_cycle()`) that is schema-only, confirmed zero call sites outside migrations, and models branch/tree *depth* (an admin's descendants), not resource *ownership* (which competitions/races a specific organizer controls) — these are different concepts and the hierarchy table should not be repurposed for this.

**Smallest safe change**: add exactly one enum value, `'organizer'`, to `user_role`, using the same single-statement-migration pattern already proven for `'admin'`. Add a new guard `requireOrganizerOrAbove()` in `lib/auth/session.ts`, mirroring `requireAdminOrAbove()`'s shape exactly (`role in ('organizer', 'admin', 'super_admin')`, or, if organizer is meant to be a peer of admin rather than beneath it — a genuine product decision, see Open Questions — a role-specific check).

**Resource-scoped authorization** — since no existing pattern models this, the recommendation is the simplest viable shape rather than reusing the dormant hierarchy: an `organizer_id` column directly on `racing_competitions` (the top-level resource), with `races`/`competitors` authorization cascading through their parent `competition_id` (an organizer can manage a race/competitor if they own its competition, or if it's not yet attached to a competition and they created it) — avoiding a separate `organizer_assignments` join table (and its own enum/relationship surface) unless a genuine multi-organizer-per-competition need emerges. `UNKNOWN — REQUIRES DECISION`: can a `super_admin` reassign a competition's `organizer_id` after creation, and can more than one organizer be assigned to the same competition? Both are real product questions this report flags rather than answers speculatively.

**The RPC security boundary is the hard constraint here, not a design preference.** Per `supabase/migrations/20260101000107_security_incident_restore_rpc_privileges.sql` (verified directly in this session, cross-confirmed by the admin/security research stream) and `tests/integration/rpc-privilege-boundary.test.ts`: every privileged/mutating RPC (`apply_wallet_transaction`, `confirm_pool_settlement`, `confirm_pool_refund`, `create_pool_entry`, `prepare_pool_settlement[_manual]`, `reverse_pool_settlement`, `abort_pool_reversal`, `undo_pool_grading`, `void_pool_entry`) is now locked to `service_role` only, with **no `authenticated` grant at all** — none of these functions check `auth.uid()` internally, so the grant *is* the only authorization boundary. **Any new organizer-facing capability (creating a race, recording a result, confirming a result, managing a competitor) must be implemented as a Server Action using `createAdminClient()` (service_role) with an internal `requireOrganizerOrAbove()`-plus-ownership check, exactly mirroring how every existing admin mutation works today (`lib/actions/pools.ts`, `lib/actions/invitations.ts`, etc.).** No new RPC should ever be granted directly to `authenticated`. If a *new* RPC is written for racing (e.g. a result-confirmation function), it must follow the exact pattern already used by every money/settlement RPC: `revoke all ... from public, anon, authenticated; grant execute ... to service_role;` and be added to `rpc-privilege-boundary.test.ts`'s `PROTECTED_RPCS` table so a future accidental widening fails CI, not just a manual audit.

---

# Prediction Template Model

**Registry mechanism** (`lib/pools/templates/types.ts`/`registry.ts`) — **B, reuse with adaptation**: `PoolTemplate<TConfig>` interface (id/version/category/name/description/`questionBuilder`/`gradingRule` returning `YES|NO|VOID|PENDING`), `getTemplate(id, version)`/`getLatestTemplate(id)` exact/latest-version resolution, duplicate-key detection at module load — all domain-agnostic and directly reusable.

**Registry content** — **D, replace**: all 17 current template bodies (`match-result.ts`, `goals.ts`, `match-events.ts`, `player-props.ts`) parse football scores/events; none transfer.

**Important nuance the brief's target templates surface, and the research confirms**: "Race Winner" (pick 1 of N competitors) is **not** the same shape as the existing binary `TEMPLATE_GRADED` pattern. Every current `TEMPLATE_GRADED` template grades to exactly `YES`/`NO` against a fixed pair of `pool_options` rows (`gradingRule` returns a binary result, `grade.ts` resolves the winning option by matching `binary_outcome`). "Who wins this race" with N competitors is structurally closer to the **legacy** `WHO_WILL_ADVANCE`/`REGULATION_RESULT` pattern (pick exactly one of several named options, matched by identity, not a Yes/No question) — except that legacy pattern lives entirely in SQL (`prepare_pool_settlement`) reading `fixtures`, which is being removed.

**Recommendation**: Race Winner and Competition Winner need a **new grading pathway**, not a reuse of the binary `TEMPLATE_GRADED` registry pattern as-is — either a new SQL function analogous to `prepare_pool_settlement` (but reading `race_results.winner_competitor_id` and matching it against a new `pool_options.competitor_id` FK instead of denormalized text), or a new `gradeRacePool()` orchestration function paralleling `gradeTemplatePool()`'s control flow but resolving "which option's `competitor_id` equals the winner" instead of a Yes/No template rule. Either way, it still terminates in the unchanged `prepare_pool_settlement_manual`/`confirm_pool_settlement` RPCs.

**V1 template recommendation**:
1. **Race Winner** — needs only `race_results.winner_competitor_id`. Simple, matches the "winner required" result model directly.
2. **Competition Winner** — same grading primitive, sourced from the competition's overall standings winner instead of a single race's winner. `UNKNOWN — REQUIRES DECISION`: how "competition winner" is determined (most points? last stage's winner?) depends on the Competition Progression decisions above, which this report flags as needing a product decision, not a database answer.

**Challenging #3/#4 as instructed**: Podium Finish and Head-to-Head are genuinely binary (`YES`/`NO`) and *would* fit the existing `TEMPLATE_GRADED` registry pattern well — but both require at least a partial finishing order (`race_result_positions` rows beyond just the winner) to grade, which conflicts with the common "winner-only" case the Result Model is explicitly designed to support. Grading either template on a winner-only result means staying `PENDING` indefinitely for any race where the organizer never bothers entering more than the winner — a real UX gap, not just an engineering one. **Recommend deferring both past V1**, consistent with the brief's own instruction not to repeat the football template-sprawl problem, and consistent with the "smallest domain model" instruction throughout.

---

# Pool Creation Changes

Current flow (verified): `admin/pools/new/pool-template-builder.tsx` (single fixture) / `multi-fixture-builder.tsx` (bulk) → `createPoolFromTemplate`/`createPoolsForFixturesAction` (`lib/actions/pools.ts`) → `createPoolForFixture` (shared insert helper). **Every discriminated-union branch of the creation schema requires a `fixtureId`** (`createPoolFromTemplateSchema`, `lib/validations/pools.ts`) — there is no fixture-less creation path in the current wizard (the comment in `pools.ts` at line 412 explicitly states CUSTOM/free-text pools "are no longer creatable here" — CUSTOM pools exist in the schema/settlement machinery but the wizard doesn't expose them).

What survives unchanged: the Server Action's audit logging, notification-trigger calls, `entry_fee`/`house_fee_bps` handling, `snapshot_version` stamping, and the underlying `pools`/`pool_options` insert shape.

What assumes fixtures: the entire fixture-selection step of both wizard components, `getTemplateEligibility(competitionType)`'s League/Cup branching, and the option-generation call into `generatePoolTemplate` (hardcoded 2/3-way).

What depends on `league_season_imports`: the `fixtures_available_for_pool_creation` view (gates fixture eligibility on `import_status = 'IMPORTED'` and `pool_creation_enabled = true`) — has no racing equivalent need, since races are organizer-created directly rather than imported.

What depends on API-Football availability: nothing in the *pool creation* code path itself calls the provider live (it reads already-synced `fixtures` rows) — the dependency is indirect, through the fixture data having been populated by the sync cron.

**Recommended racing flow**, per the brief's target: `Competition/Event → Race/Stage/Competition → Prediction Template → Configure Pool → Publish`, collapsed for the Single Race case: `Race → Template (Race Winner) → Configure → Publish`. This is fewer steps than football's flow for the common case, since there's no fixture-import/eligibility layer to navigate — directly supporting the Admin Experience section's expectation that racing's admin should feel simpler.

---

# Automatic Grading and Settlement

This is the section the brief marks as highest-stakes, and the research confirms the boundary is cleaner than it might appear.

**Code that should survive completely unchanged** (verified generic, zero football references in body):
- `apply_wallet_transaction` — the sole money-movement chokepoint.
- `confirm_pool_settlement` — payout distribution, house-fee/remainder handling, idempotency-key fan-out (`:payout:`, `:house_fee`, `:remainder`).
- `confirm_pool_refund` / `confirm_combo_refund_fee_retained` — refund distribution.
- `prepare_pool_settlement_manual` — sums `pool_options` entry counts/amounts, flags manual-verification need, inserts `settlements`. **This is the exact RPC racing's new grading path should call** — it already asks nothing about fixtures.
- `reverse_pool_settlement` (except its one `if v_pool.fixture_id is null` branch selector, which simply always takes the `else`-turned-`then` `prepare_pool_settlement_manual` path once `fixture_id` no longer exists) / `abort_pool_reversal` / `undo_pool_grading`.
- `lib/notifications/create.ts`'s settlement/refund notification builders.
- `pool_grading_evidence` table (append-only audit shape unchanged; only its *content* — what evidence a racing grading pass records — is new).

**Football-specific grading that must be replaced**:
- `prepare_pool_settlement`'s SQL-side `WHO_WILL_ADVANCE`/`REGULATION_RESULT` branches (reads `fixtures.regulation_home_score` etc. directly).
- Every `gradingRule` in the 17 template bodies.
- `grade.ts`'s `TemplateFixtureRow` input type and its binary YES/NO option-resolution logic (needs a new resolution strategy matching `pool_options.competitor_id` against `race_results.winner_competitor_id`, per the Prediction Template Model section).

**The adapter needed**: a new function analogous to `gradeTemplatePool()` — same orchestration shape (resolve template/config → run grading logic → resolve winning `pool_option` → write evidence → call `prepare_pool_settlement_manual` → call `confirm_pool_settlement`) — but reading `race_results`/`race_result_positions` instead of `fixtures`, and matching by a real `competitor_id` FK instead of `grade.ts`'s current label-fallback string matching. This keeps the *entire* settlement/wallet call chain downstream of "resolve the winning pool_option" byte-for-byte identical to what's running in production today.

**Safest-possible-change framing, directly per the brief's instruction**: the racing clone's grading work is entirely upstream of money movement — it produces a `winning_option_id`, exactly as `gradeTemplatePool` does today, and hands off to unmodified RPCs from that point on. No settlement/wallet code needs to change at all; only the code that decides *which option won* needs new logic, and that code (both today's and racing's) already lives outside the money-moving RPCs, in application-layer TypeScript (`lib/pools/templates/grade.ts`) that's easy to review, test, and roll back independently of the database functions that actually move money.

---

# Competition Progression

No existing Brohda subsystem models multi-stage tournament progression (confirmed: zero tables/functions matching "standings"/"bracket"/"group"/"advancement" in the full 35-table enumeration). This section is necessarily more hypothesis than the rest of the report, flagged accordingly.

**Recommended primitive**: `competition_stages.sequence_order` + `status` (`UPCOMING | ACTIVE | COMPLETED`), with:
- **Points/standings formats** (Championship, League): computed live from `race_results` joined through `races → stage/competition` — no separate standings table, following the leaderboard's existing "compute at read time" precedent (`get_leaderboard` RPC).
- **Knockout formats** (Bracket, Sudden-Death/Elimination): a race's `winner_competitor_id` determines advancement; **whether the next stage's `race_competitors` rows are auto-populated from the previous stage's winners, or organizer-populated manually, is an open product decision** (`UNKNOWN — REQUIRES DECISION`). Recommend manual population for V1 (organizer creates the next-round race and manually adds the winners as competitors) — this requires zero new automation code and defers the genuinely novel "bracket advancement engine" work until it's proven necessary, consistent with the brief's anti-over-abstraction instruction.
- **Mixed formats** (Group → Quarterfinal → Semifinal → Final): naturally modeled as a sequence of stages with different `stage_type` values under one `racing_competitions` row — no special-casing needed beyond what the two bullets above already cover.

This avoids building separate engines per format (directly answering the brief's Championship/League and Bracket/Sudden-Death sharing questions) while being honest that the automation depth (auto-advancement, tie-breaking rules, points formulas) is new product surface with no repo precedent to derive from.

---

# Admin / Organizer Experience

| Screen | Class | Notes |
|---|---|---|
| `admin/users`, `admin/users/[id]` | GENERIC | User management, role assignment — reusable as-is; role-set form gains an `'organizer'` option. |
| `admin/invitations` | GENERIC | Invite flow reusable; may need an invite-time role picker if organizers should be invitable directly as organizers (currently every invite accepts as `role: 'player'` — a real gap either product needs, not racing-specific). |
| `admin/wallet-requests` | GENERIC | Untouched. |
| `admin/audit-log` | GENERIC | Untouched. |
| `admin/settings` | ADAPTABLE | Registration toggle, fee defaults, payment methods — keep; the embedded `provider-status-panel.tsx` widget — remove (no provider). |
| `admin/reports`, `admin/analytics` | ADAPTABLE | Core wallet/entry/settlement aggregation queries survive; any football-labeled report dimensions need renaming/removal. |
| `admin/pools`, `admin/pools/[id]` | ADAPTABLE | List/detail/lifecycle-action UI survives; the `new/` wizard's fixture-picker step is REMOVE+REPLACE (race-picker instead). |
| `admin/competitions/*` (6 routes) | FOOTBALL-SPECIFIC | Remove wholesale — replaced by a much simpler competition/race management surface (no import/sync/health/lifecycle-audit workspace needed without an external provider). |
| `admin/fixtures` (3 modes), `admin/fixture-archive` | FOOTBALL-SPECIFIC | Remove wholesale. |

**New organizer/admin screens needed** (no existing equivalent, novel per the Organizer Permission Model gap): competitor library management (create/edit persistent competitors), race creation/scheduling, result entry + confirmation, result correction (super-admin only), and a simplified competition/stage management view. All of these are lighter-weight than their football counterparts specifically *because* there's no provider-sync lifecycle to surface — directly matching the brief's expectation that the racing admin experience should feel simpler than Brohda's football operations.

---

# Player Experience

| Area | Change | Evidence |
|---|---|---|
| Feed | ADAPT (data source only) | `app/(app)/feed/page.tsx` — generic query/render, just needs its `fixtures` join replaced. |
| Pool cards (`SocialPoolCard`, `PoolPreviewCard`, `PoolOptionButton`, `PoolDistributionBar`, `AvatarStack`) | KEEP (option rendering already N-agnostic) | `PoolOptionButton` maps over an arbitrary `options: Array<{...}>` — confirmed no 2/3-count assumption. |
| `MatchIdentity` (2-sided "VS" header) | REPLACE | Hardcoded literal `"VS"` + exactly 2 `TeamBadge`s — cannot represent a field of N racers; needs a new N-competitor-aware header or removal in favor of the generic option list doing all the display work. |
| `PoolLeagueHeader` | ADAPT | Generic countdown/visibility chrome; competition name/logo source swaps, "kickoff" framing becomes "start time." |
| Pool detail page | KEEP | Thin wrapper around `SocialPoolCard`; no changes needed beyond the card's own changes. |
| Comments | KEEP | Fully generic, `pool_id`-scoped. |
| Follows (generic `follows`) | KEEP | No sport coupling. |
| `team_follows`/`league_follows` | REPLACE | Same pattern (idempotent toggle + email pref), new tables (`competitor_follows`/`competition_follows`). |
| Profile core | KEEP | Bio/stats/pick-history fully generic. |
| Profile "Following" tab | ADAPT | Same toggle-list UI, new data source. |
| Leaderboard | KEEP | Zero football coupling found anywhere in `get_leaderboard`/`StreakWidget`/`Podium`/`RankedList`. |
| Notifications/Activity | KEEP | Zero football coupling found. |
| Search — user branch | KEEP | Untouched. |
| Search — fixture/team/league branch | REPLACE | New race/competitor/competition search, same `.ilike()` pattern; `AnalyticsCategoryCode` enum needs racing-specific categories. |
| Wallet UI (entire subsystem) | KEEP | Confirmed zero sport coupling anywhere — payment methods, fee display, deposit/withdrawal flow. |
| Design system | KEEP | Zero domain copy in any primitive. |
| Rules page | REPLACE | Entirely hardcoded football prose; full rewrite. |

Confirming the brief's example ("Red Rocket — Picked by 50% — Est. payout $9.90"): this exact rendering already works today with zero changes, since `PoolOptionButton` and `PoolDistributionBar` already consume a generic `{label, percentage, estimatedPayout}` shape per option — the football coupling in the player experience is narrower and more isolated than a first read of the codebase would suggest.

---

# Database Current-to-Target Map

35 base tables total (full inventory, purposes, and enum classification captured in the Football Dependency Map and Reuse/Adapt matrix above). Summarized by target action:

**KEEP UNCHANGED (16)**: `user_profiles`, `invitations`, `audit_logs`, `rate_limits`, `wallet_balances`, `wallet_transactions`, `entries`, `settlement_payouts`, `notifications`, `background_jobs`, `wallet_requests`, `follows`, `pool_likes`, `pool_comments`, `platform_settings`, `payment_methods`.

**ADAPT (5)**: `pools` (rename/replace `fixture_id` with `race_id`, drop football-specific status coupling), `pool_options` (drop `external_team_id`/`team_name` denormalized-team columns in favor of a `competitor_id` FK, keep `label`/`logo_url`/`sort_order`/`is_winning_option`/`entry_count`/`total_entry_amount`/`binary_outcome` as-is), `settlements` (drop `regulation_home_score`/`extra_time_*`/`penalty_*` football score columns — the equivalent race data now lives in `race_results`, not snapshotted onto `settlements`), `pool_grading_evidence` (table shape unchanged, new evidence content), `correct_prediction_log` (unchanged shape, already FK-loosened per migration `000104`).

**REMOVE (13)**: `fixtures`, `provider_request_log`, `team_players`, `teams`, `leagues`, `team_follows`, `league_follows`, `fixture_odds_cache`, `league_season_imports`, `competition_import_jobs`, `competition_import_job_chunks`, `competition_availability_cache`, `fixture_date_search_cache`.

**REPLACE — product responsibility persists, new tables (product responsibility for `teams`/`leagues`/follows carried by new tables, not literally the same shape)**: `competitors` (replaces `teams`' product role), `racing_competitions` (replaces `league_season_imports`' *product* role, none of its import-lifecycle columns), `competitor_follows`/`competition_follows` (replace `team_follows`/`league_follows`).

**NEW, no existing analog**: `competition_stages`, `races`, `race_competitors`, `race_results`, `race_result_positions`.

Each proposed new table's purpose, fields, relationships, ownership, and lifecycle are specified in full in the Competitor Model / Competition and Stage Model / Race Model / Result Model sections above — not repeated here to avoid duplication. Indexes likely required: `races(competition_id)`, `races(stage_id)`, `races(scheduled_start_utc, status)` (mirroring `fixtures`' existing sync-scan index pattern), `race_competitors(race_id)`, `race_competitors(competitor_id)`, `race_results(race_id)` unique, `race_result_positions(race_id, competitor_id)` unique, `competitors(organizer_id)`, `racing_competitions(organizer_id)`. RLS: every new table should default to the same posture as `fixtures` today (broad `authenticated` read; all writes via `service_role` through Server Actions, per the RPC privilege model) — no new table should grant `INSERT`/`UPDATE`/`DELETE` directly to `authenticated`.

**Views**: `fixtures_available_for_pool_creation` — REMOVE. `pool_options_public` — ADAPT (same privacy-gating shape via `can_view_pool_distribution()`, drop the football-flavored `external_team_id`/`team_name` columns from its `select` list). `public_profiles` — KEEP unchanged.

---

# Security Model

The RPC privilege incident fixed immediately before this report (migration `20260101000107_security_incident_restore_rpc_privileges.sql`, `tests/integration/rpc-privilege-boundary.test.ts`) is the single most important piece of context for how *any* new racing capability must be built, and this report treats it as non-negotiable, not a suggestion:

- **Every current privileged/mutating RPC is `service_role`-only**: `apply_wallet_transaction`, `confirm_pool_settlement`, `confirm_pool_refund`, `create_pool_entry`, `prepare_pool_settlement`/`prepare_pool_settlement_manual`, `reverse_pool_settlement`, `abort_pool_reversal`, `undo_pool_grading`, `void_pool_entry`, `close_own_account`, `advance_or_cancel_locked_pool`, `delete_terminal_pool`, plus every competition-import RPC (`claim_import_job_chunks`, `cleanup_import_job_chunk_payloads`, `recalculate_import_job_progress` — all being removed anyway).
- **A smaller set is `authenticated + service_role`** for legitimate direct session-scoped reads: `get_pool_totals[_bulk]`, `get_pool_participants[_bulk]`, `get_leaderboard`, `is_super_admin`, `is_admin_or_above`, `get_follow_counts`/`get_followers`/`get_following`, `get_profile_stats`, `get_stories_row`, various `get_user_*_analytics` functions, `can_view_pool_distribution`, `user_has_entered_pool`, `would_create_hierarchy_cycle`, `get_branch_member_ids`.
- **None of these functions check `auth.uid()` internally** — the Postgres `GRANT` is the entire authorization boundary, enforced by PostgREST at the API layer. `rpc-privilege-boundary.test.ts` asserts this for 53 functions and fails (SQLSTATE `42501` mismatch) if any grant is ever widened.

**For racing, this means:**
1. **No new mutating RPC should ever be granted to `authenticated`.** Result recording, race/competitor creation, competition management — all of it goes through Server Actions using `createAdminClient()` (service_role), gated by a new `requireOrganizerOrAbove()` guard plus resource-ownership check, exactly mirroring `lib/actions/pools.ts`/`lib/actions/invitations.ts`'s existing pattern.
2. **Organizer permissions must not weaken the boundary.** An organizer's authority is enforced entirely in TypeScript (the Server Action checks `role` and resource ownership before calling the service-role RPC) — never by widening a database grant, and never by adding a role-check *inside* a currently-generic RPC that would make it reachable by more callers than it already accepts.
3. **Any genuinely new RPC** (e.g., a racing-specific result-confirmation function, if one is written instead of doing confirmation purely in the Server Action) must follow the exact `revoke all ... from public, anon, authenticated; grant execute ... to service_role;` pattern already used by every money/settlement function, and must be added to `PROTECTED_RPCS` in `rpc-privilege-boundary.test.ts` — this is now a codified regression gate, not a manual-review-only expectation.
4. **RLS on new tables** should mirror `fixtures`' current posture (broad authenticated read, service-role-only write) unless a specific new need (e.g., organizer-only write access to their own draft races before publish) requires something narrower — which, if built, should be a real RLS policy referencing `organizer_id`, not a wider RPC grant.

The clone should start from a security posture that is *already correct*, rather than one where football's history of drift (documented in `SECURITY_RPC_PRIVILEGE_INCIDENT_REPORT.md`) gets a second chance to happen in a new codebase.

---

# Background Jobs and Cron

| Job | Class | Reasoning |
|---|---|---|
| `sync-fixtures` | REMOVE | Exists solely to poll API-Football. |
| `discover-competitions` | REMOVE | Exists solely to re-scan the provider for new fixtures in already-imported competitions. |
| `process-competition-imports` | REMOVE | Chunked import processing for a provider racing doesn't have. |
| `refresh-recommendation-cache` | REMOVE | Availability-cache refresh for the football "Recommended competitions" admin tab. |
| `lock-pools` | KEEP | Purely `pools.locks_at <= now()` status-driven; zero fixture knowledge (confirmed no football coupling in this route by the provider research stream). |
| `process-results` | ADAPT | Currently triggers `gradeTemplatePool()`/the legacy SQL grading path once a fixture is `COMPLETED`. For racing, this becomes a reconciliation job over races whose `race_results.status = 'CONFIRMED'` haven't yet produced a settlement — see below for why this should be secondary, not primary. |

**On polling vs. event-triggered grading**, per the brief's explicit prompt: racing has no external provider to poll — a race result is an organizer action, not a fact that arrives asynchronously on someone else's schedule. **Recommend triggering grading synchronously from the result-confirmation Server Action** (organizer confirms → immediately call the new racing-grading function → settlement happens in the same request, or a background-queued follow-up within the same action's execution), with the adapted `process-results` cron retained *only* as a safety-net reconciliation pass (catches any confirmed result that, for whatever reason — a transient error, a server restart mid-request — never triggered grading), not as the primary mechanism. This is a strict improvement over today's polling-only model, made possible specifically because racing results don't arrive from an external feed on an unpredictable schedule the way fixture completions do.

This recommendation is also informed directly by a real, currently-open issue in production: the existing `sync-fixtures` cron overlaps itself (each run takes 4–5 minutes but fires every 1 minute with no lock, confirmed in `SECURITY_RPC_PRIVILEGE_INCIDENT_REPORT.md`'s root-cause investigation and the standing "Cron batching" deferred item) — a purely event-triggered racing-grading path avoids inheriting this exact failure mode, since there's no unbounded per-tick loop over external data to overlap against.

Cron infrastructure itself (`CRON_SECRET` bearer-auth pattern, cron-job.org external scheduling per `docs/DEPLOYMENT.md`, `background_jobs` run-history table) is fully generic and reusable as-is for whichever jobs racing keeps.

---

# Test Strategy

Full classification (73 unit files, 36 integration files, 1 e2e spec) captured in detail by the parallel test-inventory research stream. Summarized:

**KEEP UNCHANGED** (~40 unit files, ~19 integration files): all generic-infrastructure tests — `guards.test.ts`, `money.test.ts`, `humanize.test.ts`, `settlement-logic.test.ts`, `reversal-logic.test.ts`, `streaks.test.ts`, `notices.test.ts`, `pool-view-model.test.ts`, `card-state.test.ts`, `transitions.test.ts`, `enter-pool-action.test.ts`, `notification-*.test.ts`, `profile-*.test.ts`, `wallet-*.test.ts`, `date-*.test.ts`, `avatar*.test.ts`, and generic UI-component tests, plus integration tests `admin-role`, `close-account`, `feed-pool-cap`, `follows`, `large-in-clause`, `leaderboard`, `pool-bulk-rpc`, `pool-comments`, `pool-deletion`, `pool-likes`, `profile-fields`, `rate-limit`, `realtime-payout`, `registration`, `reversal`, `rls`, `rpc-privilege-boundary`, `stories`, `user-analytics`, `wallet-requests`, `wallet`, and the sole e2e spec `invite-flow.spec.ts`.

**REMOVE** (~15 unit files, ~10 integration files): everything testing the provider client, fixture/competition import machinery, and football template content — `api-football-provider.test.ts`, `fixture-events-normalizer.test.ts`, `competition-classification.test.ts`, `recommended-competitions.test.ts`, `supported-competitions.test.ts`, `provider-gateway.test.ts`, `status-map.test.ts`, `goals-odds.test.ts`, `pool-templates.test.ts`, `pool-templates-registry.test.ts`, `pool-templates-registry-events.test.ts`, `question-families.test.ts`, `template-cards.test.ts`; integration `competition-crons`, `competition-fixture-aggregates`, `competition-imports`, `competition-manager-catalog-error`, `fixture-discovery`, `fixtures-management`, `pool-creation-eligibility`, `template-pools-events`, `template-pools`, `combo-pools` (borderline, football-flavored end-to-end wiring).

**ADAPT** (~10 unit files, ~5 integration files): tests with reusable mechanics but football-flavored test data/subject — `fixture-persist.test.ts` (rename to `race-persist`), `fixture-date-window.test.ts`/`fixture-filters.test.ts`/`fixture-grouping.test.ts` (reusable date/grouping logic, retarget at races), `odds-consensus.test.ts`/`odds-devig.test.ts`/`odds-mapping.test.ts` (pure math, reusable if racing ever sources odds similarly — otherwise remove), `create-pools-for-fixtures-action.test.ts` (retarget at race-based bulk creation), `import-chunks.test.ts` (only if any racing bulk-operation reuses chunking — otherwise remove), `pool-league-header.test.tsx`/`social-pool-card.test.tsx` (retarget fixtures for races), `team-follows-action.test.ts` (retarget as `competitor-follows`), `settlements.test.ts` (currently tests settling a `REGULATION_RESULT` pool — retarget at a racing pool type, keep the settlement-math assertions).

**NEW RACING TESTS REQUIRED** (unit + integration, not written yet per the brief's instruction — listed for planning only):
- N-competitor race creation (2, 3, and >4 competitors in one race).
- Persistent competitor creation and reuse across races; race-only competitor creation and later promotion to persistent.
- Competitor identity validation: 1–4 colors, name-optional, number-optional, "at least one identifying attribute" enforcement.
- Organizer authorization: organizer can manage their own competition/races/competitors; organizer cannot manage another organizer's; unauthenticated/wrong-role rejected (extending the `rpc-privilege-boundary.test.ts` pattern to any new racing RPC).
- Winner-only result grading (Race Winner template resolves correctly with zero `race_result_positions` rows beyond the winner).
- Full finishing-order result grading.
- Result confirmation workflow (organizer confirms → grading fires → settlement occurs, end-to-end, mirroring `template-pools.test.ts`'s existing shape but against `race_results`).
- Result correction/reversal after settlement (extending `reversal.test.ts`'s pattern to a race-result-driven settlement).
- Championship/League standings computation from `race_results` across multiple races.
- Bracket/knockout progression (manual population for V1, per the Competition Progression recommendation).
- Mixed-stage competition traversal (Group → Knockout).

CI structure (`quality`/`integration`/`e2e` jobs, local-Supabase-stack pattern, `API_FOOTBALL_ENABLED=false` placeholder env) is fully reusable — the `integration` and `e2e` jobs' env-var block simply drops the three `API_FOOTBALL_*` lines with no other change needed.

---

# Brand and Copy Coupling

Explicitly separated from architectural changes, per the brief's instruction — **this section is about strings and assets, not schema or code structure.**

- **"brohda" brand name**: ~44 occurrences across ~20 application files (`app/`, `components/`, `lib/`), concentrated in legal pages (`app/privacy/`, `app/terms/`, `components/legal/LegalPage.tsx`), metadata (`app/manifest.ts`, `app/layout.tsx`), landing/auth chrome (`components/AppShell.tsx`, `components/landing/LandingNav.tsx`/`LandingFooter.tsx`), and email sending (`lib/email/resend.ts`'s `FROM_ADDRESS` and a hardcoded logo path). No branching logic keys off the string — this is a mechanical find/replace exercise, not an architectural one.
- **Football/soccer terminology**: `fixture`, `team`, `league` are deeply structural (~1418, ~448, ~421 occurrences respectively) — real database tables/columns/types (`FixtureInternalStatus`, `NormalizedFixture`), not just copy. `goal`/`regulation` carry structural weight specifically inside the pool-template enum system (`CardCategory` values like `"GOALS"`, pool-type values like `"REGULATION_RESULT"`) — these encode football's actual game structure into business logic, not just labels, and are addressed by the schema/template changes elsewhere in this report, not by a copy sweep. `football`/`soccer` appear mostly as the vendor module name (`apiFootballProvider`, imported in ~10 files) and two swappable marketing sentences (`app/manifest.ts`, `components/landing/LandingHero.tsx`). `match` is mostly generic-English-word noise (`.match()`, "matches these filters") plus some swappable UI copy — not structurally significant on its own.
- **Icons/imagery**: no football-specific icons or SVG assets exist — team/league logos are entirely remote-URL data rendered through a generic `<img src={logoUrl}>` pattern with no crest-compositing logic; `lucide-react` icon usage (`Trophy`, `Star`, etc.) is generic and reusable as-is.
- **Rules page**: the one place brand/copy coupling and architectural change overlap — its content is 100% football-specific prose (kickoff/extra-time/penalties/cards language) and needs a full rewrite, but the *page component itself* requires zero structural change.

---

# Environment and External Services

| Variable | Class |
|---|---|
| `API_FOOTBALL_BASE_URL`, `API_FOOTBALL_KEY`, `API_FOOTBALL_ENABLED` | REMOVE — the entire football-specific env surface (confirmed via full `process.env` grep, no other football-tied variable exists). |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` | KEEP — Supabase infra, applies identically to a new Supabase project. |
| `DEFAULT_TIMEZONE`, `APP_URL`, `CRON_SECRET` | KEEP — generic. |
| `RESEND_API_KEY` | KEEP — generic transactional email; only the `FROM_ADDRESS`/logo-path copy needs updating (see Brand and Copy Coupling). |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | KEEP — generic observability. |
| `VERCEL_OIDC_TOKEN` | KEEP — platform-managed, not app-referenced directly. |

**Deployment config**: `vercel.json` is minimal (`{"regions": ["pdx1"]}`) — no cron config lives there (per `docs/DEPLOYMENT.md`, cron runs through the free external scheduler cron-job.org, not Vercel Cron, specifically to stay on Vercel's free Hobby tier). Of the three currently-configured cron-job.org jobs (`sync-fixtures`, `lock-pools`, `process-results`), only `sync-fixtures` is football-named and gets dropped; `lock-pools`/`process-results` carry over conceptually (see Background Jobs section).

**Dependencies**: `package.json` has **zero football/sports-data-specific npm packages** — API-Football is consumed via a raw HTTP client inside `lib/sports-data/api-football-provider.ts`, not a vendor SDK. This means removing the football provider has zero `package.json` surface area — it's purely an internal-module deletion (one file plus its call sites), not a dependency-tree change.

---

# Subtraction Plan

Direct answer to "what can we delete because racing owns its event data":

**Pages/routes**: `app/(admin)/admin/competitions/**` (all 6 routes — list, `[id]` dashboard/health/synchronization/lifecycle, plus the settings/templates redirect stubs), `app/(admin)/admin/fixtures/**` (all 3 modes plus shared components), `app/(admin)/admin/fixture-archive/`.

**Components**: `components/pools/MatchIdentity.tsx` (replace, don't just delete — its display responsibility persists in a new form), the fixture-mode-specific pieces of the admin fixtures UI (`date-mode/`, `competition-mode.tsx`, `fixture-id-mode.tsx`, `mode-tabs.tsx`, `imported-fixtures-list.tsx`), `provider-status-panel.tsx`.

**Actions/services**: `lib/sports-data/**` entirely (provider client, status-map, provider-gateway's football-specific quota-string matching, persist.ts's football upsert logic) — except `http.ts`'s generic `fetchWithRetry` wrapper, which can stay as reusable plumbing with no current caller. `lib/competitions/**` entirely (import-chunks, process-chunk, process-imports-cron, discovery-sync, workspace-data, manager-data, status, availability-cache, badge-classes, supported-competitions).

**Provider clients**: the `ApiFootballProvider` singleton and its entire 884-line implementation.

**Cron jobs**: `sync-fixtures`, `discover-competitions`, `process-competition-imports`, `refresh-recommendation-cache` route handlers.

**Database tables**: `fixtures`, `provider_request_log`, `team_players`, `teams`, `leagues`, `team_follows`, `league_follows`, `fixture_odds_cache`, `league_season_imports`, `competition_import_jobs`, `competition_import_job_chunks`, `competition_availability_cache`, `fixture_date_search_cache` (13 tables). Views `fixtures_available_for_pool_creation`. Note: since this is a genuinely **separate** Supabase project (per the task's explicit constraint), "delete" here means *don't create these tables at all in the new project's migration history* — not running destructive migrations against the existing production Brohda database, which this report does not touch.

**Database functions**: `prepare_pool_settlement` (the football-specific legacy path), `claim_import_job_chunks`, `cleanup_import_job_chunk_payloads`, `recalculate_import_job_progress`.

**Environment variables**: `API_FOOTBALL_BASE_URL`, `API_FOOTBALL_KEY`, `API_FOOTBALL_ENABLED`.

**Admin screens**: the entire competition-workspace/fixture-browser admin surface (already covered above under Pages/routes).

**Tests**: the ~15 unit + ~10 integration football-specific test files enumerated in Test Strategy.

**Configuration**: nothing in `vercel.json` (already minimal, no football-specific entries), no `package.json` dependency removal needed (none exist to begin with).

**Seed scripts**: `scripts/seed.ts` and `scripts/seed-dev-grading.ts` both need full rewrites (not deletion — the *product* of having deterministic dev-seed data is still needed, just built around races instead of fixtures) — categorized here for completeness even though "replace" is more accurate than "delete."

The racing clone should not carry any of the above "just in case" — per the brief's explicit instruction, and because every item above has a real, disqualifying reason (external-provider dependency, football-specific enum/scoring content, or zero remaining callers once the provider is gone).

---

# Systems That Must Not Be Touched

Restated plainly, as the report's own explicit boundary:

1. **The wallet/settlement RPCs**: `apply_wallet_transaction`, `confirm_pool_settlement`, `confirm_pool_refund`, `confirm_combo_refund_fee_retained`, `prepare_pool_settlement_manual`, `reverse_pool_settlement`, `abort_pool_reversal`, `undo_pool_grading`. Zero changes. Racing's new grading code produces a `winning_option_id` and calls these exactly as `gradeTemplatePool` does today.
2. **The RPC privilege security model**: migration `20260101000107` and `tests/integration/rpc-privilege-boundary.test.ts`. No new mutating capability — organizer or otherwise — gets a direct `authenticated` grant. Every new privileged operation goes through a Server Action + service_role, following the exact existing pattern.
3. **The append-only ledger/audit tables**: `wallet_transactions`, `audit_logs`, `pool_grading_evidence` — their mutation-forbidding triggers (`forbid_audit_log_mutation`, `forbid_pool_grading_evidence_mutation`) and the deliberate FK-less design on `wallet_transactions.pool_id/entry_id/settlement_id` (so ledger history survives hard-deleted pools) — this pattern must be preserved for any new racing-specific append-only table too.
4. **Idempotency-key conventions**: the `base_key:suffix` pattern (`:payout:`, `:house_fee`, `:remainder`, `:refund:`, `:reversal:`) — any new caller into `apply_wallet_transaction` must follow this convention, not invent a new one.
5. **The role/guard model**: `is_super_admin`/`is_admin_or_above` and `requireSuperAdmin()`/`requireAdminOrAbove()` — money movement, account/role management, and audit-log access stay `super_admin`-only exactly as today; a new `organizer` role must not be granted any of these existing super_admin-gated capabilities.
6. **CI/test infrastructure**: the three-job CI structure, the local-Supabase-stack integration/e2e pattern, and specifically `rpc-privilege-boundary.test.ts`'s pattern of asserting `42501` for unauthorized roles — every new privileged RPC racing introduces must be added to this test, not exempted from it.

---

# Edge Cases

Per the brief's specific list, with a grounding note on each:

- **Ties/dead heats**: `race_result_positions.position` as designed allows two competitors to share a position value (no uniqueness constraint proposed) — grading logic for Race Winner would need an explicit tie-handling rule (e.g., void with `NO_WINNING_ENTRIES`-style refund, or split payout) — `UNKNOWN — REQUIRES DECISION`, no existing Brohda precedent for a tied outcome (football grading always resolves to a single winner or a well-defined draw option).
- **Disqualifications/DNF/abandoned races**: covered by `race_result_positions.finish_status` in the Result Model — but the *product* decision of whether a DSQ'd competitor's backers get refunded or lose is new; `pool_void_reason`'s existing `ONE_SIDED_POOL`/`NO_WINNING_ENTRIES` values may partially cover this, `UNKNOWN — REQUIRES DECISION` on the exact mapping.
- **Reruns**: no existing Brohda concept of "redo this same fixture" — a rerun would need to be a new `races` row, not a mutation of the original; if a pool was already settled against the original race, that's a settlement-reversal scenario (existing `reverse_pool_settlement` mechanics apply) followed by a fresh pool against the new race row.
- **Result corrections after settlement**: directly covered by existing `reverse_pool_settlement`/`undo_pool_grading` — see Result Trust and Corrections below.
- **Organizer editing another organizer's competition**: prevented by the resource-ownership check recommended in the Organizer Permission Model (Server-Action-level, not RLS-level, matching how all current admin authorization works).
- **Deleting a persistent competitor with historical races**: since `competitors` rows are never hard-deleted (only `is_active = false`, matching `fixtures.hidden_from_pool_creation`'s soft-delete precedent), and `race_competitors`/`race_results` reference `competitor_id` by FK, historical race data remains intact even if a competitor is deactivated — no special handling needed beyond the standard soft-delete pattern already used elsewhere (`user_profiles.is_active`).
- **Race-only competitor later needing history**: solved by the `is_persistent` flag design in the Competitor Model — promotion is a single-column update, no data migration.
- **Pools spanning multiple stages/races**: not currently supported by any Brohda pool (every pool references exactly one `pool_id ↔ fixture_id`/future `race_id`) — a "Competition Winner" pool template spans an entire competition conceptually but still attaches to a single `pools` row (not one per race), which already matches how the existing schema works (one `pools` row, `pool_options` for each competitor, graded against a competition-level result rather than a single race's).

---

# Risk Assessment

| Risk | Severity | Likelihood | Why it matters | Mitigation |
|---|---|---|---|---|
| Accidentally modifying money-moving RPCs while building the racing grading adapter | HIGH | MEDIUM | These RPCs are the hardest-won, most heavily tested part of Phases 1–9; any change risks reintroducing a settlement bug. | Treat `apply_wallet_transaction`/`confirm_pool_*`/`prepare_pool_settlement_manual` as literally frozen files; the new grading code is the only new surface, and it terminates in unmodified RPC calls. |
| Widening an RPC grant to `authenticated` for organizer convenience | HIGH | MEDIUM | Directly reopens the exact vulnerability class fixed in the incident that preceded this report. | New capabilities go through Server Actions + service_role only; every new RPC added to `rpc-privilege-boundary.test.ts`. |
| Assuming exactly 2 competitors somewhere not yet found | MEDIUM | MEDIUM | Confirmed hardcoding exists in 3 specific places (`lib/pools/templates.ts`, `grade.ts`'s binary resolution, `MatchIdentity.tsx`) — a 4th undiscovered spot is plausible given the codebase's size. | Build and test with a 5+-competitor race in V1 development explicitly, not just 2–3, to surface any remaining assumption early. |
| Stale football FKs left in a half-migrated schema | MEDIUM | LOW (mitigated by separate-database strategy) | Since the racing clone gets its own Supabase project (per the task's explicit constraint), this risk is largely eliminated by construction — there's no shared database to leave stale references in. | Confirm the new project's migration history never includes the 13 REMOVE-classified tables at all, rather than creating-then-dropping them. |
| Result corrections after settlement moving money incorrectly | HIGH | LOW | Wallet clawback is real money leaving a (possibly already-spent) user balance. | Reuse `reverse_pool_settlement`'s existing dry-run-then-commit pattern unchanged — it already handles the "can't fully claw back" case via `REVERSAL_FAILED_MANUAL_REVIEW`, without inventing new logic. |
| Organizer trust — an organizer entering a wrong result | MEDIUM | MEDIUM | Real money is at stake on every result. | Result Trust and Corrections section below; reuse existing reversal/undo-grading machinery rather than building a new dispute system. |
| Ties/DNF/DSQ ungraded indefinitely | MEDIUM | MEDIUM | A race whose result can't cleanly resolve to a single winner leaves its pool stuck `PENDING`, mirroring today's `MANUAL_REVIEW` pattern for football's `BINARY_OPTIONS_UNRESOLVABLE`. | Route unresolvable results into the existing `MANUAL_REVIEW` pool status (already exists — `pool_review_reason` enum's `BINARY_OPTIONS_UNRESOLVABLE`/`TEMPLATE_VERSION_UNRESOLVABLE`/`TEMPLATE_CONFIG_INVALID` pattern generalizes directly to a new `RACE_RESULT_UNRESOLVABLE` reason). |
| Bracket/championship result corrections cascading through dependent stages | HIGH | LOW (if V1 avoids auto-advancement) | Correcting an early-round result after later rounds have already been populated (manually or automatically) could invalidate downstream races/pools. | V1 recommendation (manual bracket population, no auto-advancement) sidesteps this entirely — a correction only affects the one race/pool it touches, not a cascade. Auto-advancement, if built later, needs its own dedicated risk analysis before implementation. |
| Pools spanning multiple stages needing new settlement semantics | LOW | LOW | Confirmed the existing one-pool-per-event model already handles "Competition Winner" without needing a multi-race pool concept. | No mitigation needed — not actually a gap, per Edge Cases analysis above. |
| Migration/cloning risk: copying incident-adjacent drift into the new project | MEDIUM | LOW | The exact RPC-grant drift that caused the recent incident could theoretically be re-introduced if the new project's migrations are hand-authored loosely rather than derived from the corrected `brohda-rc1` migration set. | Start the new project's migration history from `brohda-rc1`'s already-corrected grant patterns (every `revoke ... grant ... to service_role` statement), not from an earlier, pre-incident snapshot. |

---

# V1 Recommendation

Smallest viable racing product that preserves everything the brief asks to preserve:

- **Domain model**: `competitors`, `racing_competitions` (format = `SINGLE_RACE` and `LEAGUE`/`CHAMPIONSHIP` only for V1 — defer `BRACKET`/`ELIMINATION`/`MIXED`), `competition_stages` (built, but only exercised by non-knockout formats in V1), `races`, `race_competitors`, `race_results`, `race_result_positions`.
- **Roles**: `super_admin`, `admin`, `player`, `organizer` (new) — organizer authorization via a single `organizer_id` column on `racing_competitions`, no separate assignment table yet.
- **Templates**: Race Winner, Competition Winner only.
- **Result entry**: winner-required, full-order optional, organizer-confirmed, super-admin-correctable via the existing reversal/undo-grading machinery.
- **Grading**: event-triggered from the result-confirmation Server Action, with a reconciliation cron as a safety net (not the primary path).
- **Admin/organizer UI**: competitor library, race creation/scheduling, result entry/confirmation, competition/stage management (flat list, no bracket-builder UI).
- **Player UI**: feed, pool cards (N-competitor-aware), pool detail, comments, follows (renamed), profile, leaderboard, notifications, search, wallet — all as close to unchanged as the research above shows they can be.

---

# Explicitly Do Not Build Yet

- Bracket/knockout auto-advancement (manual population only in V1).
- Podium Finish / Head-to-Head templates (deferred past V1 per the Prediction Template Model analysis — grading complexity vs. winner-only result data).
- A separate `organizer_assignments` join table (single `organizer_id` column is sufficient until a real multi-organizer-per-competition need is proven).
- Any odds/consensus/de-vig pipeline for racing (no evidence racing has an equivalent external odds source; `lib/pools/templates/odds-*.ts`'s math is reusable *if* one ever appears, but nothing in V1 needs it).
- A generic multi-sport/plugin architecture, shared Brohda/Racing database, or monorepo — per the brief's explicit instruction and because nothing in the codebase makes any of these unavoidable.
- Full dispute-resolution system for contested results — the existing reversal/undo-grading machinery is sufficient for V1's "organizer confirms, super-admin corrects" workflow.
- Automated points/standings-formula configurability — hardcode one reasonable formula for V1, don't build a rules engine.

---

# Proposed Implementation Phases

Hypothesis, subtraction-and-foundations-first as instructed — not implemented, no code written for these phases.

**Phase 0 — Clone isolation and safety**
Objective: stand up the new repo/Supabase/Vercel project, confirm zero shared infrastructure with production Brohda.
Affected: new git repo, new Supabase project, new Vercel project, new env vars.
Database impact: none against existing Brohda production.
Dependencies: none.
Tests: CI pipeline stood up and green on the cloned-but-unmodified codebase first, before any subtraction begins.
Do-not-touch: the existing `brohda.com` production project, in every respect.
Rollback: trivial — nothing shared, delete the clone.

**Phase 1 — Remove provider/import infrastructure**
Objective: delete the 13 football-specific tables, `lib/sports-data/**`, `lib/competitions/**`, the 4 football-only cron routes, `admin/competitions/**`, `admin/fixtures/**`, `admin/fixture-archive/**`, and the ~15+10 football-specific tests, from the *clone's* migration history and codebase.
Affected: as enumerated in Subtraction Plan.
Database impact: the clone's schema simply never includes these tables — confirmed safe since this is a fresh Supabase project, not a destructive migration against shared data.
Dependencies: Phase 0.
Tests: full suite still green minus the removed football-specific files; `lock-pools`/`process-results` crons still function against zero fixtures (no pools exist to lock/grade yet, which is expected).
Do-not-touch: `apply_wallet_transaction`, `confirm_pool_*`, `prepare_pool_settlement_manual`, `reverse_pool_settlement`, `abort_pool_reversal`, `undo_pool_grading`.
Rollback: this phase only deletes, so rollback is "don't proceed" rather than "undo a mutation."

**Phase 2 — Racing domain schema**
Objective: add `competitors`, `racing_competitions`, `competition_stages`, `races`, `race_competitors`, `race_results`, `race_result_positions`; adapt `pools`/`pool_options` (rename `fixture_id`→`race_id`, add `competitor_id` to `pool_options`).
Database impact: new tables + two column changes on existing generic tables.
Dependencies: Phase 1 (needs `fixture_id` gone before `race_id` can cleanly take its place).
Tests: new schema-level tests (table existence, FK integrity, RLS default posture) before any app code depends on them.
Do-not-touch: `entries`, `settlements`, `settlement_payouts`, `wallet_*` tables — no column changes needed there at all.
Rollback: additive migrations only until Phase 2's `pools` column rename — that specific step should be its own isolated, easily-revertable migration.

**Phase 3 — Organizer permissions**
Objective: add `'organizer'` to `user_role`, `organizer_id` on `racing_competitions`, `requireOrganizerOrAbove()` guard.
Database impact: one enum-add migration (single-statement, per the `'admin'` precedent), one column-add.
Dependencies: Phase 2 (`racing_competitions` must exist).
Tests: extend `rpc-privilege-boundary.test.ts`'s pattern to any new organizer-facing RPC; explicit "organizer cannot touch another organizer's resource" test.
Do-not-touch: `is_super_admin`/`is_admin_or_above` themselves — add alongside, don't modify.
Rollback: enum values can't be removed once added (Postgres limitation) — treat this as a one-way door, get the value name right before merging.

**Phase 4 — Competition/race creation**
Objective: new admin/organizer Server Actions + UI for competitors, races, competitions/stages, replacing the fixture-based wizard.
Dependencies: Phases 2–3.
Tests: N-competitor race creation, persistent vs. race-only competitor creation, color/number identity validation.
Do-not-touch: the pool-creation Server Action's core insert shape (`entry_fee`/`house_fee_bps`/audit-log/notification calls) — only its input source changes.

**Phase 5 — Racing prediction templates**
Objective: Race Winner, Competition Winner template bodies + the new grading-resolution function (matching `pool_options.competitor_id` against `race_results.winner_competitor_id`).
Dependencies: Phase 4.
Tests: grading correctness against winner-only and full-order results.
Do-not-touch: the template registry's `getTemplate`/`getLatestTemplate` mechanism — extend its content, don't restructure it.

**Phase 6 — Result entry and grading**
Objective: organizer result-confirmation Server Action, event-triggered grading call, reconciliation cron.
Dependencies: Phase 5.
Tests: end-to-end result → grading → settlement, mirroring `template-pools.test.ts`'s existing shape.
Do-not-touch: `confirm_pool_settlement`/`confirm_pool_refund` — the grading function's only interface to them is exactly what `gradeTemplatePool` already uses.

**Phase 7 — Competition progression**
Objective: standings computation (Championship/League), manual bracket-round population (Knockout/Elimination), if V1 scope includes them (V1 Recommendation above suggests deferring Bracket/Elimination).
Dependencies: Phase 6.
Tests: standings correctness across multiple races; manual bracket-round creation.
Do-not-touch: nothing new here touches money-moving code directly — standings are read-only computation.

**Phase 8 — Player-facing adaptation**
Objective: `MatchIdentity` replacement/removal, `PoolLeagueHeader` adaptation, feed/search data-source swap, follows rename, rules-page rewrite.
Dependencies: Phases 4–6 (need real races/pools to render against).
Tests: N-competitor pool-card rendering (2, 3, 5+ competitors) — directly targeting the risk flagged above.
Do-not-touch: `PoolOptionButton`, `PoolDistributionBar`, `AvatarStack`, comments, wallet UI, design system — confirmed already generic, zero changes needed.

**Phase 9 — Admin/organizer refinement**
Objective: polish competitor library, race scheduling, result-correction UI, settlement-exception views.
Dependencies: Phase 8.
Tests: organizer-vs-organizer authorization edge cases, result-correction audit trail.
Do-not-touch: `admin/users`, `admin/wallet-requests`, `admin/audit-log` — unchanged throughout.

**Phase 10 — Racing-specific testing and launch verification**
Objective: full NEW-tests list from Test Strategy section, CI green, a launch-verification pass mirroring this engagement's own Phase 9/release-runbook rigor (test gate, migration audit, RPC privilege boundary re-verification, production smoke test).
Dependencies: all prior phases.
Do-not-touch: nothing new — this phase is verification only.

---

# Open Questions

Genuine product decisions this report could not answer from repository evidence alone:

1. Can a `super_admin` reassign a competition's `organizer_id` after creation? Can multiple organizers share one competition?
2. Should `'organizer'` be a peer of `'admin'` or subordinate to it in `requireOrganizerOrAbove()`'s role check?
3. Should invitations support inviting someone directly as `'organizer'`, or does every organizer start as `'player'` and get promoted (mirroring today's `'admin'` promotion-only pattern)?
4. Exact points/standings formula for Championship/League formats.
5. Whether bracket/knockout round advancement is ever automated, and if so, on what trigger.
6. Tie/dead-heat handling for Race Winner grading — void, split payout, or something else.
7. DSQ/DNF payout treatment — refund the backer, or treat as a loss?
8. Whether a rerun creates a new `races` row linked back to the original for display purposes, or is treated as fully independent.
9. Whether Podium Finish/Head-to-Head should require the organizer to always enter a full order (removing the winner-only case for those specific templates) once they're eventually built, rather than trying to grade off partial data.
10. Whether the racing product needs its own odds/consensus data source at all, or whether pool configuration (entry fee, house fee) stays purely admin/organizer-set with no market-derived suggestion feature (which `lib/pools/templates/odds-*.ts` currently provides for football).

A senior engineer picking this up cold would need answers to #1–#3 before Phase 3, #4–#5 before Phase 7, and #6–#7 before Phase 5 could be considered complete (not just "graded," but "correctly graded" for the edge cases every real racing product will hit in week one).

---

# Final Architecture Recommendation

**Clone `brohda-rc1`. Do not rewrite Brohda as a generic platform, and do not build racing as a module inside it.**

The evidence supports this specifically because the parts of Brohda that are hardest to get right — the settlement/wallet engine and the RPC security model — are already domain-agnostic at the code level, verified by direct inspection of every relevant RPC body, not assumed. The football-specific surface, while real, is concentrated and well-bounded: 13 of 35 database tables, one legacy settlement RPC, one provider client module with zero package.json footprint, four cron jobs, a handful of admin routes, and a narrow band of application code (three specific files) responsible for the two/three-sided assumption the brief was most concerned about.

This is not a generic prediction platform wearing a racing skin — it is a racing product that happens to reuse a proven wallet, settlement, social, and security foundation, with a genuinely new (and appropriately scoped) domain layer for competitions, stages, races, competitors, and results. The open questions above are real product decisions, not architectural gaps — the architecture itself is sound to build on.

**Recommendation: proceed with cloning `brohda-rc1` as the baseline.**
