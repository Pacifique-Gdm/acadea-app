import { auth } from "../firebase";
import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import { inspectOfflineOperations, transitionOfflineOperation, type OfflineOperation, type OfflineOperationKind, type OfflineScope } from "./offlineQueue";
import type { OfflineDraftPayloads } from "./offlineDrafts";

type PendingOperation = OfflineOperation<OfflineDraftPayloads[OfflineOperationKind]>;
type ApiResult = { ok?: boolean; gradeId?: string; attendanceId?: string; student?: { id: string };
  payment?: { id: string; studentId: string; schoolId: string; schoolYearId: string; currency: string; receiptNumber?: string };
  code?: string; error?: string };
const running = new Map<string, Promise<OfflineSyncResult>>();
export type OfflineSyncResult = "DONE" | "AUTH_REQUIRED";

export function offlineRetryDelay(attempts: number, random = Math.random()): number {
  const exponent = Math.min(5, Math.max(0, attempts - 1));
  return Math.min(60_000, Math.round(2_000 * 2 ** exponent * (0.9 + Math.min(1, Math.max(0, random)) * 0.2)));
}

async function submit(scope: OfflineScope, operation: PendingOperation): Promise<void> {
  const token = await getCurrentFirebaseIdToken();
  if (auth?.currentUser?.uid !== scope.userId) {
    const error = new Error("Le compte connecté ne correspond plus au brouillon local.") as Error & { code: string };
    error.code = "auth/account-mismatch";
    throw error;
  }
  const payload = operation.payload;
  let endpoint: string;
  let body: Record<string, unknown>;
  switch (operation.kind) {
    case "grade":
      endpoint = "/api/manage-teacher-grading";
      body = { action: "sync-offline-grade", schoolId: scope.schoolId, schoolYearId: scope.schoolYearId,
        operationId: operation.id, ...payload };
      break;
    case "attendance":
      endpoint = "/api/manage-teacher-grading";
      body = { action: "sync-offline-attendance", operationId: operation.id,
        schoolId: scope.schoolId, schoolYearId: scope.schoolYearId, ...payload };
      break;
    case "student_enrollment": {
      const enrollment = payload as OfflineDraftPayloads["student_enrollment"];
      endpoint = "/api/provision-school-account";
      body = { action: "save-manual-student", offlineOperationId: operation.id,
        student: { ...enrollment, id: `student-${operation.id}`, schoolId: scope.schoolId,
          schoolYearId: scope.schoolYearId, annee_scolaire_id: scope.schoolYearId,
          matricule: "", status: "ACTIVE", address: "", phone: "" } };
      break;
    }
    case "payment_proposal": {
      const proposal = payload as OfflineDraftPayloads["payment_proposal"];
      endpoint = "/api/manage-financial-transaction";
      body = { action: "create-payment", schoolYearId: scope.schoolYearId,
        studentId: proposal.studentId, feeTypeId: proposal.feeTypeId, amount: proposal.amount,
        note: proposal.note ?? "", expectedCurrency: proposal.currency,
        expectedFeeAmount: proposal.expectedFeeAmount, clientRequestId: operation.id };
      break;
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  let result: ApiResult;
  try {
    response = await fetch(resolveApiUrl(endpoint), { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal });
    result = await response.json().catch(() => ({})) as ApiResult;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const error = new Error(result.error || `Synchronisation refusée (HTTP ${response.status}).`) as Error & { status: number; code?: string };
    error.status = response.status;
    error.code = result.code;
    throw error;
  }
  if (operation.kind === "grade" && (!result.ok || !result.gradeId)) throw new Error("Accusé de cote incomplet.");
  if (operation.kind === "attendance" && (!result.ok || !result.attendanceId)) throw new Error("Accusé de présence incomplet.");
  if (operation.kind === "student_enrollment" && result.student?.id !== `student-${operation.id}`) throw new Error("Accusé d'inscription incomplet.");
  if (operation.kind === "payment_proposal") {
    const proposal = payload as OfflineDraftPayloads["payment_proposal"];
    if (!result.payment?.id || !result.payment.receiptNumber || result.payment.schoolId !== scope.schoolId
      || result.payment.schoolYearId !== scope.schoolYearId || result.payment.studentId !== proposal.studentId
      || result.payment.currency !== proposal.currency) throw new Error("Accusé de paiement incomplet ou incohérent.");
  }
}

async function syncUnlocked(scope: OfflineScope, onChange?: () => void): Promise<OfflineSyncResult> {
  if (auth?.currentUser?.uid !== scope.userId) return "AUTH_REQUIRED";
  const { operations } = await inspectOfflineOperations(scope) as { operations: PendingOperation[] };
  for (const operation of operations.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (auth?.currentUser?.uid !== scope.userId) return "AUTH_REQUIRED";
    if (["SERVER_CONFIRMED", "CONFLICT", "REJECTED"].includes(operation.status)) continue;
    if (operation.status === "SYNCING") await transitionOfflineOperation(scope, operation.id, "RETRYABLE_ERROR", "Vérification après interruption.");
    if (Date.parse(operation.expiresAt) <= Date.now()) {
      await transitionOfflineOperation(scope, operation.id, "REJECTED", "Brouillon expiré : vérification humaine nécessaire.");
      onChange?.();
      continue;
    }
    await transitionOfflineOperation(scope, operation.id, "SYNCING");
    onChange?.();
    try {
      await submit(scope, operation);
      await transitionOfflineOperation(scope, operation.id, "SERVER_CONFIRMED");
    } catch (cause) {
      const error = cause as Error & { status?: number; code?: string };
      const authenticationFailure = error.status === 401 || error.code === "unauthenticated"
        || ["auth/account-mismatch", "auth/invalid-user-token", "auth/user-token-expired", "auth/user-disabled"].includes(error.code ?? "");
      const temporaryFailure = [408, 425, 429].includes(error.status ?? 0);
      const status = error.status === 409 ? "CONFLICT" : authenticationFailure || temporaryFailure || !error.status || error.status >= 500
        ? "RETRYABLE_ERROR" : "REJECTED";
      await transitionOfflineOperation(scope, operation.id, status, error.message || "Réponse serveur indisponible.");
      if (authenticationFailure) { onChange?.(); return "AUTH_REQUIRED"; }
    }
    onChange?.();
  }
  return "DONE";
}

/** Sends only after a fresh Firebase token; the server remains the authority for every operation. */
export function syncOfflineOperations(scope: OfflineScope, onChange?: () => void): Promise<OfflineSyncResult> {
  const key = JSON.stringify([scope.userId, scope.schoolId, scope.schoolYearId]);
  const existing = running.get(key);
  if (existing) return existing;
  const task = async (): Promise<OfflineSyncResult> => {
    if ("locks" in navigator) return navigator.locks.request("acadea-offline-sync", { mode: "exclusive" }, () => syncUnlocked(scope, onChange));
    return syncUnlocked(scope, onChange);
  };
  const promise = task().finally(() => { running.delete(key); });
  running.set(key, promise);
  return promise;
}
