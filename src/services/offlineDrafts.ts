import { readOfflineAccess, type OfflineAccess } from "./offlineAccess";
import { queueOfflineOperation, type OfflineOperation, type OfflineOperationKind, type OfflineScope } from "./offlineQueue";

type GradeDraft = {
  assignmentId: string; classId: string; subjectId: string; studentId: string;
  gradingSlot: string; status: "graded" | "not_graded" | "absent"; score: number | null;
  expectedGradeUpdatedAt: string | null; expectedMaximumUpdatedAt: string;
  maximumAtCapture: number;
};
type AttendanceDraft = {
  studentId: string; attendanceDate: string; status: "present" | "absent" | "late";
  manualReason: string; expectedAttendanceUpdatedAt: string | null;
};
type EnrollmentDraft = {
  nom: string; postnom: string; prenom: string; sexe: "M" | "F";
  birthDate: string; classId: string; classOptionKey?: string;
};
type PaymentProposal = {
  studentId: string; feeTypeId: string; amount: number; currency: "CDF" | "USD";
  note?: string;
};

export type OfflineDraftPayloads = {
  grade: GradeDraft;
  attendance: AttendanceDraft;
  student_enrollment: EnrollmentDraft;
  payment_proposal: PaymentProposal;
};

const roles: Record<OfflineOperationKind, OfflineAccess["role"][]> = {
  grade: ["teacher"], attendance: ["discipline_director"],
  student_enrollment: ["school_admin", "secretary"], payment_proposal: ["cashier"],
};
const text = (value: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 160;
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const stamp = (value: string | null) => value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));

export function validateOfflineDraft<K extends OfflineOperationKind>(kind: K, draft: OfflineDraftPayloads[K]): void {
  if (kind === "grade") {
    const row = draft as GradeDraft;
    if (![row.assignmentId, row.classId, row.subjectId, row.studentId, row.gradingSlot].every(text)
      || !["graded", "not_graded", "absent"].includes(row.status)
      || !stamp(row.expectedGradeUpdatedAt) || !text(row.expectedMaximumUpdatedAt)
      || !Number.isFinite(Date.parse(row.expectedMaximumUpdatedAt))
      || !Number.isFinite(row.maximumAtCapture) || row.maximumAtCapture <= 0
      || (row.status === "graded" ? !Number.isFinite(row.score) || row.score === null || row.score < 0 || row.score > row.maximumAtCapture : row.score !== null)) {
      throw new Error("Brouillon de cote incomplet ou incompatible avec le maximum préchargé.");
    }
  } else if (kind === "attendance") {
    const row = draft as AttendanceDraft;
    if (!text(row.studentId) || !date(row.attendanceDate) || !["present", "absent", "late"].includes(row.status)
      || !text(row.manualReason) || !stamp(row.expectedAttendanceUpdatedAt)) {
      throw new Error("Brouillon de présence invalide.");
    }
  } else if (kind === "student_enrollment") {
    const row = draft as EnrollmentDraft;
    if (![row.nom, row.postnom, row.prenom, row.classId].every(text)
      || !["M", "F"].includes(row.sexe) || !date(row.birthDate)
      || (row.classOptionKey !== undefined && !text(row.classOptionKey))) {
      throw new Error("Brouillon d'inscription incomplet.");
    }
  } else {
    const row = draft as PaymentProposal;
    if (!text(row.studentId) || !text(row.feeTypeId) || !Number.isFinite(row.amount)
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
  return queueOfflineOperation(scope, kind, draft);
}
