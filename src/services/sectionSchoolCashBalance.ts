import type { AppUser } from "../types";
import { loadExpenseCashBalance } from "./personnelPayroll";
import { sectionAdministratorQuerySections } from "../utils/sectionAdministratorYearScope";

export async function loadSectionSchoolCashBalance(user: AppUser, schoolId: string, yearId: string) {
  sectionAdministratorQuerySections(user, schoolId);
  const balance = await loadExpenseCashBalance(yearId);
  if (balance.schoolId !== schoolId || balance.schoolYearId !== yearId
    || !["CDF", "USD"].includes(balance.currency)) throw new Error("Solde hors établissement ou année scolaire.");
  return balance;
}
