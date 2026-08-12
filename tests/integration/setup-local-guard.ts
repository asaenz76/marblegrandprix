// Vitest integration setup: hard-fail the whole integration run if it is
// pointed at a non-local Supabase database. Runs once per test file before any
// test, so no integration test can accidentally hit a hosted DB.
import { assertLocalSupabase } from "@/lib/dev/assert-local-supabase";

assertLocalSupabase("the integration test suite");
