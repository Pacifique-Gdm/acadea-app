import { auth } from "../firebase";
import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import { listOfflineOperations, transitionOfflineOperation, type OfflineOperation, type OfflineOperationKind, type OfflineScope } from "./offlineQueue";
import type { OfflineDraftPayloads } from "./offlineDrafts";

type PendingOperation = OfflineOperation<OfflineDraftPayloads[OfflineOperationKind]>;
type ApiResult = { ok?: boolean; gradeId?: string; attendanceId?: string; student?: { id: string };
  payment?: { id: string; studentId: string; schoolId: string; schoolYearId: string; currency: string; receiptNumber?: string };
  code?: string; error?: string };
const running = new Map<string, Promise<void>>();

async function submit(scope: OfflineScope, operation: PendingOperation): Promise<void> {
  const token = await getCurrentFirebaseIdToken();
  if (auth?.currentUser?.uid !== scope.userId) throw new Error("Le compte connecté ne correspond plus au brouillon local.");
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
  const response = await fetch(resolveApiUrl(endpoint), { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as ApiResult;
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

async function syncUnlocked(scope: OfflineScope, onChange?: () => void): Promise<void> {
  if (auth?.currentUser?.uid !== scope.userId) return;
  const operations = await listOfflineOperations(scope) as PendingOperation[];
  for (const operation of operations.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
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
      const status = error.status === 409 ? "CONFLICT" : error.status && error.status < 500 && error.status !== 429 ? "REJECTED" : "RETRYABLE_ERROR";
      await transitionOfflineOperation(scope, operation.id, status, error.message || "Réponse serveur indisponible.");
    }
    onChange?.();
  }
}

/** Sends only after a fresh Firebase token; the server remains the authority for every operation. */
export function syncOfflineOperations(scope: OfflineScope, onChange?: () => void): Promise<void> {
  const key = JSON.stringify([scope.userId, scope.schoolId, scope.schoolYearId]);
  const existing = running.get(key);
  if (existing) return existing;
  const task = async () => {
    if ("locks" in navigator) await navigator.locks.request("acadea-offline-sync", { mode: "exclusive" }, () => syncUnlocked(scope, onChange));
    else await syncUnlocked(scope, onChange);
  };
  const promise = task().finally(() => { running.delete(key); });
  running.set(key, promise);
  return promise;
}
