import type { AppUser } from "../types";
import { isSectionAdministratorRole, sectionAdministratorQuerySections } from "./sectionAdministratorYearScope";

/** UI guard only; every financial mutation is checked again by its server handler. */
export function canManageSectionStudentFinances(user: AppUser, schoolId: string, archived: boolean): boolean {
  if (archived || !isSectionAdministratorRole(user.role)) return false;
  try {
    return sectionAdministratorQuerySections(user, schoolId).length > 0;
  } catch {
    return false;
  }
}
