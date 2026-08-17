import { describe, expect, it } from "vitest";
import { assessBootstrapTarget } from "@/lib/dev/prod-bootstrap";
import { assertLocalSupabase, isLocalSupabaseUrl } from "@/lib/dev/assert-local-supabase";

const LOCAL = "http://127.0.0.1:54321";
const HOSTED = "https://abcxyz.supabase.co";

// Phase 14: the first-Super-Admin bootstrap is the ONE sanctioned exception to
// the local-only Supabase rule. These prove the exception is narrow — a hosted
// target needs every explicit safeguard — and, critically, that the exception
// does NOT leak into the shared assertLocalSupabase guard used by seeds/tests.
describe("assessBootstrapTarget", () => {
  it("allows a local target with no flags (unchanged behavior)", () => {
    expect(assessBootstrapTarget({ url: LOCAL, allowProdBootstrap: false }).decision).toBe("local");
    expect(assessBootstrapTarget({ url: "http://localhost:54321", allowProdBootstrap: false }).decision).toBe("local");
  });

  it("refuses a hosted target without ALLOW_PROD_BOOTSTRAP", () => {
    const r = assessBootstrapTarget({ url: HOSTED, allowProdBootstrap: false });
    expect(r.decision).toBe("refused");
    expect(r.decision === "refused" && r.reason).toMatch(/ALLOW_PROD_BOOTSTRAP/);
  });

  it("refuses a hosted target with the flag but no expected project host", () => {
    const r = assessBootstrapTarget({ url: HOSTED, allowProdBootstrap: true });
    expect(r.decision).toBe("refused");
    expect(r.decision === "refused" && r.reason).toMatch(/expected project host|project-host/i);
  });

  it("refuses a hosted target when the expected host does not match", () => {
    const r = assessBootstrapTarget({ url: HOSTED, allowProdBootstrap: true, expectedHost: "other.supabase.co" });
    expect(r.decision).toBe("refused");
    expect(r.decision === "refused" && r.reason).toMatch(/does not match/i);
  });

  it("authorizes a hosted target only with the flag AND a matching expected host", () => {
    expect(assessBootstrapTarget({ url: HOSTED, allowProdBootstrap: true, expectedHost: "abcxyz.supabase.co" }).decision).toBe("prod-authorized");
    // case-insensitive host match
    expect(assessBootstrapTarget({ url: HOSTED, allowProdBootstrap: true, expectedHost: "ABCXYZ.supabase.co" }).decision).toBe("prod-authorized");
  });

  it("refuses a missing/invalid URL", () => {
    expect(assessBootstrapTarget({ url: "", allowProdBootstrap: true, expectedHost: "x" }).decision).toBe("refused");
    expect(assessBootstrapTarget({ url: "not a url", allowProdBootstrap: true, expectedHost: "x" }).decision).toBe("refused");
  });
});

describe("the local guard is NOT relaxed by the bootstrap flag (scoped exception)", () => {
  it("assertLocalSupabase still refuses a hosted URL even when ALLOW_PROD_BOOTSTRAP=1", () => {
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevFlag = process.env.ALLOW_PROD_BOOTSTRAP;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://prod.supabase.co";
      process.env.ALLOW_PROD_BOOTSTRAP = "1";
      // Represents a seed / dev-grading / verification / integration-setup caller.
      expect(() => assertLocalSupabase("seed")).toThrow(/NON-LOCAL/i);
      expect(isLocalSupabaseUrl("https://prod.supabase.co")).toBe(false);
      expect(isLocalSupabaseUrl(LOCAL)).toBe(true);
    } finally {
      if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
      if (prevFlag === undefined) delete process.env.ALLOW_PROD_BOOTSTRAP;
      else process.env.ALLOW_PROD_BOOTSTRAP = prevFlag;
    }
  });
});
