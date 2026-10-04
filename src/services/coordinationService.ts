import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import type { Coordination, AppUser, ParentProfile, PersonnelProfile, SchoolClassRecord } from "../types";
import type { HistoricalDebt } from "./financialTransactions";
import { validateArrearsTotals, type ArrearsTotals } from "../utils/arrearsFilter";

type CoordinationInput = { name: string; code?: string; phone?: string; email?: string; address?: string; schoolIds: string[]; coordinator: { name: string; email: string; password: string } };
export type CoordinationSettingsInput = { name: string; code?: string; phone?: string; email?: string; address?: string; logoUrl?: string };
export type CoordinatorIdentity = { name: string; email: string; phone: string };
export async function updateCoordinationAsSuperAdmin(coordinationId: string, values: Omit<CoordinationSettingsInput, "logoUrl">) { return call({ action: "update-coordination", coordinationId, ...values }); }
export async function createCoordinator(coordinationId: string, values: CoordinatorIdentity & { password: string }) { return call({ action: "create-coordinator", coordinationId, ...values }); }
export async function updateCoordinator(coordinationId: string, userId: string, values: CoordinatorIdentity) { return call({ action: "update-coordinator", coordinationId, userId, ...values }); }
export async function setCoordinatorStatus(coordinationId: string, userId: string, action: "suspend-coordinator" | "reactivate-coordinator" | "remove-coordinator", confirmation?: string) { return call({ action, coordinationId, userId, ...(confirmation !== undefined ? { confirmation } : {}) }); }
export type CoordinationPersonnelTransferInput = { personnelId: string; sourceSchoolId: string; destinationSchoolId: string; mutationDate: string; reason: string; confirmation: string };
type CoordinationResponse = { coordination: Coordination; coordinator: AppUser; schoolIds: string[] };

async function call(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-coordination"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Opération Coordination impossible.");
  return payload;
}

export async function createCoordination(input: CoordinationInput) { return call({ action: "create", ...input }) as Promise<CoordinationResponse>; }
export async function addCoordinationSchool(coordinationId: string, schoolId: string) { return call({ action: "add-school", coordinationId, schoolId }); }
export async function removeCoordinationSchool(coordinationId: string, schoolId: string) { return call({ action: "remove-school", coordinationId, schoolId }); }
export async function updateCoordinationSettings(settings: CoordinationSettingsInput) { return call({ action: "update-settings", ...settings }); }
export async function loadCoordinationStudentArrears(studentId: string) {
  return call({ action: "read-student-arrears", studentId }) as Promise<{ debts: HistoricalDebt[]; settled: HistoricalDebt[] }>;
}
export async function loadCoordinationClassFilterChoices() {
  const result = await call({ action: "read-class-filter-choices" }) as { classes: SchoolClassRecord[] };
  return result.classes;
}
export async function loadCoordinationStudentArrearsBatch(studentIds: string[]) {
  const result = await call({ action: "read-student-arrears-batch", studentIds }) as { totals?: ArrearsTotals };
  return validateArrearsTotals(result.totals, studentIds);
}
export async function loadCoordinationStudentArrearsDetailsBatch(studentIds: string[]) {
  const result = await call({ action: "read-student-arrears-batch", studentIds, includeDetails: true }) as { totals?: ArrearsTotals; details?: Record<string, HistoricalDebt[]> };
  validateArrearsTotals(result.totals, studentIds);
  if (!result.details || studentIds.some((id) => !Array.isArray(result.details?.[id]))) throw new Error("Détail des arriérés incomplet.");
  return result.details;
}
export async function loadCoordinationStudentParent(studentId: string) {
  const payload = await call({ action: "read-student-parent", studentId }) as { parent?: ParentProfile | null };
  return payload.parent ?? null;
}
export async function loadCoordinationPersonnelProfile(personnelId: string) {
  const payload = await call({ action: "read-personnel-profile", personnelId }) as { profile?: PersonnelProfile | null };
  return payload.profile ?? null;
}
export async function transferCoordinationPersonnel(input: CoordinationPersonnelTransferInput) {
  return call({ action: "transfer-personnel", ...input }) as Promise<{ user: AppUser; profile: PersonnelProfile | null; sourceSchoolId: string; destinationSchoolId: string; mutationDate: string }>;
}
