import { CashBalanceError, resolveRecordedCurrency } from "./cashBalance.js";
import { resolveCoordinationSchoolScope } from "./coordination.js";
import { FinancialApiError } from "./financialTransactions.js";

export async function listResolvedExpenseCurrencies({ db, caller, body }) {
  const expenseIds = body.expenseIds;
  if (!Array.isArray(expenseIds) || expenseIds.length < 1 || expenseIds.length > 50
    || new Set(expenseIds).size !== expenseIds.length
    || expenseIds.some((id) => typeof id !== "string" || !/^[\w-]{1,150}$/.test(id))) {
    throw new FinancialApiError(400, "invalid-argument", "Dépenses demandées invalides.");
  }
  const coordinationRole = ["coordination_admin", "sub_coordination_admin"].includes(caller.role);
  if (!coordinationRole && !["school_admin", "cashier"].includes(caller.role)) {
    throw new FinancialApiError(403, "permission-denied", "Consultation financière interdite.");
  }
  const allowedSchools = new Set(coordinationRole
    ? await resolveCoordinationSchoolScope(db, caller) : [caller.schoolId]);
  const snapshots = await db.getAll(...expenseIds.map((id) => db.doc(`expenses/${id}`)));
  const resolvedCurrencies = {};
  for (const snapshot of snapshots) {
    if (!snapshot.exists || !allowedSchools.has(snapshot.data()?.schoolId)) {
      throw new FinancialApiError(403, "permission-denied", "Consultation financière interdite.");
    }
    try {
      resolvedCurrencies[snapshot.id] = await resolveRecordedCurrency(snapshot.data(), {
        db, documentId: snapshot.id, collection: "expenses",
      });
    } catch (error) {
      if (!(error instanceof CashBalanceError)) throw error;
      // No inferred currency is returned when the reciprocal payroll link fails.
    }
  }
  return { resolvedCurrencies };
}
