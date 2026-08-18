"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCompetitorImageAction } from "@/lib/actions/races";
import { RacingImageUploader } from "./RacingImageUploader";

/**
 * Phase 16: operator control to set/clear a competitor's photo from the race
 * page, so an already-created competitor can get a photo without recreating the
 * race. Uploads via the shared uploader, then persists through the scoped
 * update action (authorized against the race's competition, server-side).
 */
export function CompetitorImageEditor({
  raceId,
  competitorId,
  imageUrl,
}: {
  raceId: string;
  competitorId: string;
  imageUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(imageUrl);

  function apply(url: string | null) {
    setError(null);
    setCurrent(url);
    startTransition(async () => {
      const res = await updateCompetitorImageAction({ raceId, competitorId, imageUrl: url });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <RacingImageUploader value={current} onChange={apply} label="photo" disabled={pending} />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
