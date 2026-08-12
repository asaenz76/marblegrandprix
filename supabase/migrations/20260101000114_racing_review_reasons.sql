-- Racing fork — Phase 5: racing manual-review reasons.
--
-- Own file (enum ADD VALUE); used only by application code (racing grading),
-- never in this migration's own statements. Route a racing pool to
-- MANUAL_REVIEW when the confirmed result cannot deterministically resolve a
-- single winning option — the racing analogue of the football
-- BINARY_OPTIONS_UNRESOLVABLE gate. No money semantics.
alter type public.pool_review_reason add value 'RACE_RESULT_UNRESOLVABLE';
alter type public.pool_review_reason add value 'WINNER_NOT_IN_POOL_OPTIONS';
