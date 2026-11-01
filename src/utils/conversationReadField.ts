import type { AppUser } from "../types";

/** These legacy counters belong to a role, not to every administrative user. */
export function conversationReadField(role: AppUser["role"]) {
  switch (role) {
    case "parent": return "unreadParentCount";
    case "cashier": return "unreadCashierCount";
    case "discipline_director": return "unreadDisciplineCount";
    case "school_admin": return "unreadAdminCount";
    default: return null;
  }
}
