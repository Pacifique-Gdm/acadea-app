import type { AppUser, SchoolYear } from "../types";
import type { StudentRecordCapabilities } from "../components/students/StudentRecordDrawer";

/** Fiche élève depuis « Enregistrer un paiement » (caissier).
 * Ouverte au lot C : le serveur et les règles accordent au caissier les droits du secrétaire sur la fiche élève. */
export const CASHIER_STUDENT_RECORDS_ENABLED = true;

/** Mêmes droits que le secrétaire sur la fiche élève : créer, modifier, parent, options et sous-classes. */
export function cashierStudentRecordCapabilities(user: Pick<AppUser, "role" | "status" | "active">, year: Pick<SchoolYear, "status">, enabled = CASHIER_STUDENT_RECORDS_ENABLED): StudentRecordCapabilities {
  const allowed = enabled && user.role === "cashier" && user.status !== "inactive" && user.active !== false && year.status === "active";
  return { canCreate: allowed, canEdit: allowed, canCreateParent: allowed, canManageOptions: allowed };
}
