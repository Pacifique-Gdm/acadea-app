import { readOfflineAccess, type OfflineAccess } from "./offlineAccess";
import { listOfflineOperations, queueOfflineOperation, type OfflineOperation, type OfflineOperationKind, type OfflineScope } from "./offlineQueue";

type GradeDraft = {
  assignmentId: string; classId: string; subjectId: string; studentId: string;
  gradingSlot: string; status: "graded" | "not_graded" | "absent"; score: number | null;
  expectedGradeVersion: string | null; expectedMaximumVersion: string;
  maximumAtCapture: number;
};
type AttendanceDraft = {
  studentId: string; attendanceDate: string; status: "present" | "absent" | "late";
  manualReason: string; expectedAttendanceVersion: string | null;
};
type EnrollmentDraft = {
  nom: string; postnom: string; prenom: string; sexe: "M" | "F";
  birthDate: string; classId: string; className: string; subClassId?: string;
  classOptionKey?: string; option?: string; section?: string;
};
type PaymentProposal = {
  studentId: string; feeTypeId: string; amount: number; currency: "CDF" | "USD";
  expectedFeeAmount: number; note?: string;
};

export type OfflineDraftPayloads = {
  grade: GradeDraft;
  attendance: AttendanceDraft;
  student_enrollment: EnrollmentDraft;
  payment_proposal: PaymentProposal;
};

function targetKey(kind: OfflineOperationKind, value: unknown): string {
  const row = value as Record<string, unknown>;
  if (kind === "grade") return JSON.stringify([kind, row.classId, row.subjectId, row.studentId, row.gradingSlot]);
  if (kind === "attendance") return JSON.stringify([kind, row.studentId, row.attendanceDate]);
  if (kind === "student_enrollment") return JSON.stringify([kind, row.nom, row.postnom, row.prenom, row.birthDate, row.classId]);
  return JSON.stringify([kind, row.studentId, row.feeTypeId, row.amount, row.currency]);
}

const roles: Record<OfflineOperationKind, OfflineAccess["role"][]> = {
  grade: ["teacher"], attendance: ["discipline_director"],
  student_enrollment: ["school_admin", "secretary"], payment_proposal: ["cashier"],
};
const text = (value: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 160;
const date = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const version = (value: string | null) => value === null || (typeof value === "string" && /^\d{1,12}:\d{1,9}$/.test(value));

export function validateOfflineDraft<K extends OfflineOperationKind>(kind: K, draft: OfflineDraftPayloads[K]): void {
  if (kind === "grade") {
    const row = draft as GradeDraft;
    if (![row.assignmentId, row.classId, row.subjectId, row.studentId, row.gradingSlot].every(text)
      || !["graded", "not_graded", "absent"].includes(row.status)
      || !version(row.expectedGradeVersion) || !version(row.expectedMaximumVersion) || row.expectedMaximumVersion === null
      || !Number.isFinite(row.maximumAtCapture) || row.maximumAtCapture <= 0
      || (row.status === "graded" ? !Number.isFinite(row.score) || row.score === null || row.score < 0 || row.score > row.maximumAtCapture : row.score !== null)) {
      throw new Error("Brouillon de cote incomplet ou incompatible avec le maximum préchargé.");
    }
  } else if (kind === "attendance") {
    const row = draft as AttendanceDraft;
    if (!text(row.studentId) || !date(row.attendanceDate) || !["present", "absent", "late"].includes(row.status)
      || !text(row.manualReason) || !version(row.expectedAttendanceVersion)) {
      throw new Error("Brouillon de présence invalide.");
    }
  } else if (kind === "student_enrollment") {
    const row = draft as EnrollmentDraft;
    if (![row.nom, row.postnom, row.prenom, row.classId, row.className].every(text)
      || !["M", "F"].includes(row.sexe) || !date(row.birthDate)
      || [row.subClassId, row.classOptionKey, row.option, row.section].some((value) => value !== undefined && !text(value))) {
      throw new Error("Brouillon d'inscription incomplet.");
    }
  } else {
    const row = draft as PaymentProposal;
    if (!text(row.studentId) || !text(row.feeTypeId) || !Number.isFinite(row.expectedFeeAmount) || row.expectedFeeAmount <= 0 || !Number.isFinite(row.amount)
      || row.amount <= 0 || !["CDF", "USD"].includes(row.currency)
      || (row.note !== undefined && row.note.length > 500)) {
      throw new Error("Proposition de paiement invalide.");
    }
  }
}

/** Local preparation only. This function never sends a request or issues a receipt. */
export async function captureOfflineDraft<K extends OfflineOperationKind>(
  userId: string, kind: K, draft: OfflineDraftPayloads[K], now = Date.now(),
): Promise<OfflineOperation<OfflineDraftPayloads[K]>> {
  const ticket = await readOfflineAccess(userId, now);
  if (!ticket || !roles[kind].includes(ticket.role)) throw new Error("Session locale ou rôle non autorisé.");
  validateOfflineDraft(kind, draft);
  const scope: OfflineScope = { userId: ticket.userId, schoolId: ticket.schoolId, schoolYearId: ticket.schoolYearId };
  const save = async () => {
    const existing = (await listOfflineOperations(scope)).find((operation) => operation.kind === kind
      && operation.status !== "SERVER_CONFIRMED" && operation.status !== "REJECTED"
      && targetKey(kind, operation.payload) === targetKey(kind, draft));
    if (existing) throw new Error("Un brouillon pour cette même opération existe déjà. Vérifiez son statut avant une nouvelle saisie.");
    return queueOfflineOperation(scope, kind, draft);
  };
  const operation = typeof navigator !== "undefined" && "locks" in navigator
    ? await navigator.locks.request(`acadea-offline-draft-${scope.userId}`, { mode: "exclusive" }, save)
    : await save();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("acadea:offline-operation-queued"));
  return operation;
}
