import type { School } from "../types";

export const MISSING_FINANCIAL_OPERATION_SCHOOL_ERROR = "Impossible de générer le document : l’école liée à cette opération est introuvable.";

export function resolveFinancialOperationSchool(operation: { schoolId: string }, schoolsById: ReadonlyMap<string, School>) {
  return schoolsById.get(operation.schoolId);
}
