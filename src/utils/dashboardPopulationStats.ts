import type { AppUser, ParentProfile } from "../types";
import { isArchivedPersonnel } from "../services/personnel";

const DASHBOARD_ROLES = ["school_admin", "cashier", "discipline_director"] as const;
type DashboardRole = typeof DASHBOARD_ROLES[number];

export function uniqueActiveParentCount(parents: readonly ParentProfile[]) {
  const identities = new Set<string>();
  parents.filter((parent) => parent.status !== "inactive").forEach((parent) => {
    const identity = parent.userId?.trim() || parent.id;
    if (identity) identities.add(identity);
  });
  return identities.size;
}

export function activeDashboardPersonnelCounts(users: readonly AppUser[], schoolId: string) {
  const counts: Record<DashboardRole, number> = { school_admin: 0, cashier: 0, discipline_director: 0 };
  const seen = new Set<string>();
  users.forEach((user) => {
    if (user.schoolId !== schoolId || !DASHBOARD_ROLES.includes(user.role as DashboardRole) || isArchivedPersonnel(user)) return;
    const identity = user.id.trim();
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    counts[user.role as DashboardRole] += 1;
  });
  return counts;
}
