import { redirect } from "next/navigation";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";
import { CompetitionCreateForm } from "./competition-create-form";

// Standalone competition creation (Phase 10). Creating a competition is global,
// so it's Super-Admin-only; an organizer is redirected to the competitions list.
export default async function NewCompetitionPage() {
  const profile = await requireOrganizerOrAbove();
  if (!isSuperAdmin(profile)) redirect("/racing/competitions");

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">New competition</h1>
      <CompetitionCreateForm />
    </div>
  );
}
