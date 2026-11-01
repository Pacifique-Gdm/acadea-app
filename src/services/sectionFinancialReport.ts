import type { AppUser, CashInflow, Expense } from "../types";
import { loadSectionSchoolYear } from "./sectionSchoolRecords";
import { loadControlHistoryPage, type ControlHistoryCursor } from "./controlHistory";
import { sectionAdministratorQuerySections } from "../utils/sectionAdministratorYearScope";

export async function loadSectionFinancialReport(user: AppUser, schoolId: string, schoolYearId: string) {
  sectionAdministratorQuerySections(user, schoolId);
  async function ledger<T extends Expense | CashInflow>(kind: "expenses" | "cashInflows") {
    const items = new Map<string, T>();
    const seen = new Set<string>();
    let cursor: ControlHistoryCursor | null = null;
    do {
      const page = await loadControlHistoryPage<T>(kind, schoolId, schoolYearId, user, cursor);
      page.items.forEach((item) => items.set(item.id, item));
      cursor = page.lastVisible;
      if (cursor && seen.has(cursor.id)) throw new Error("Pagination comptable incohérente.");
      if (cursor) seen.add(cursor.id);
    } while (cursor);
    return [...items.values()];
  }
  const [school, expenses, cashInflows] = await Promise.all([
    loadSectionSchoolYear(user, schoolYearId), ledger<Expense>("expenses"), ledger<CashInflow>("cashInflows"),
  ]);
  return { ...school, students: school.students.filter((student) => student.schoolYearId === schoolYearId), expenses, cashInflows };
}
