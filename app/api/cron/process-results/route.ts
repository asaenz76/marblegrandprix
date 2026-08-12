import { NextResponse } from "next/server";
import { processAwaitingResults } from "@/lib/pools/settle";
import { reconcileRacingSettlements } from "@/lib/racing/reconcile";
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
  return NextResponse.json({ ...result, racingReconciled: Object.keys(racing).length });
}
