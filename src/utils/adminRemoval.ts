import type { AppUser } from "../types";

export const ADMIN_REMOVAL_CONFIRMATION = "SUPPRIMER ADMINISTRATEUR";

export function canConfirmAdminRemoval(value: string) {
  return value === ADMIN_REMOVAL_CONFIRMATION;
}

export function markAdminRemoved(admin: AppUser, removedAt: string, removedBy: string): AppUser {
  return { ...admin, status: "inactive", removedAt, removedBy };
}
