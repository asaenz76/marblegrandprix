import { NextResponse } from "next/server";
import { processAwaitingResults } from "@/lib/pools/settle";
import { reconcileRacingSettlements, reconcileRacingProgression } from "@/lib/racing/reconcile";
import { recordJobRun } from "@/lib/jobs/record";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await recordJobRun("process-results", () => processAwaitingResults());
  // Idempotent safety net for racing pools whose event-driven settlement was
  // missed (transient error / restart). Normal racing settlement is event-driven
  // on result confirmation — this never double-pays (settleRacePool is idempotent).
  const racing = await reconcileRacingSettlements();
  // Idempotent progression safety net (Phase 8): fill any downstream slot a
  // transient error left empty and publish a champion once a final is confirmed.
  const progression = await reconcileRacingProgression();
  return NextResponse.json({ ...result, racingReconciled: Object.keys(racing).length, racingProgression: progression });
}
