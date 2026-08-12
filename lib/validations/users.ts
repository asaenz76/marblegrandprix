import { z } from "zod";

// Assignable roles are player <-> organizer only. Deliberately excludes
// 'super_admin' (minting one stays a manual/create-super-admin-script action)
// AND the legacy 'admin' value (LEGACY TECHNICAL ROLE — NO NEW PRODUCT USE):
// no new user may be promoted to 'admin' through this path. Promoting to
// 'organizer' is Super-Admin-only (setUserRoleAction calls requireSuperAdmin).
export const setUserRoleSchema = z
  .object({
    userId: z.string().uuid(),
    role: z.enum(["player", "organizer"]),
  })
  .strict();

export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

// Mirrors createInvitationSchema's email handling — always lands as role
// 'player', same as an accepted invitation; promoting stays a separate,
// deliberate setUserRoleAction step.
export const createUserManuallySchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    displayName: z.string().trim().min(1).max(60),
  })
  .strict();

export type CreateUserManuallyInput = z.infer<typeof createUserManuallySchema>;
