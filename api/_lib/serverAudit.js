import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export const AUDIT_EVENT_TYPES = Object.freeze({
  SCHOOL_CREATED: "school.created", SCHOOL_UPDATED: "school.updated", SCHOOL_SUSPENDED: "school.suspended", SCHOOL_REACTIVATED: "school.reactivated",
  USER_CREATED: "user.created", USER_UPDATED: "user.updated", USER_DELETED: "user.deleted", USER_DISABLED: "user.disabled", USER_REACTIVATED: "user.reactivated",
  PARENT_UNLINKED_FROM_STUDENT: "parent.unlinked_from_student",
  STUDENTS_IMPORTED: "students.imported_from_archive",
  STUDENT_TERMINAL_REENROLLED: "student.terminal_reenrolled",
  FINANCE_PAYMENT_CREATED: "finance.payment.created", FINANCE_PAYMENT_UPDATED: "finance.payment.updated", FINANCE_PAYMENT_DELETED: "finance.payment.deleted",
  FINANCE_EXPENSE_CREATED: "finance.expense.created", FINANCE_EXPENSE_UPDATED: "finance.expense.updated", FINANCE_EXPENSE_DELETED: "finance.expense.deleted",
});

const labels = Object.freeze({
  [AUDIT_EVENT_TYPES.SCHOOL_CREATED]: "Création école", [AUDIT_EVENT_TYPES.SCHOOL_UPDATED]: "Modification école", [AUDIT_EVENT_TYPES.SCHOOL_SUSPENDED]: "Suspension école", [AUDIT_EVENT_TYPES.SCHOOL_REACTIVATED]: "Réactivation école",
  [AUDIT_EVENT_TYPES.USER_CREATED]: "Création utilisateur", [AUDIT_EVENT_TYPES.USER_UPDATED]: "Modification utilisateur", [AUDIT_EVENT_TYPES.USER_DELETED]: "Suppression utilisateur", [AUDIT_EVENT_TYPES.USER_DISABLED]: "Désactivation utilisateur", [AUDIT_EVENT_TYPES.USER_REACTIVATED]: "Réactivation utilisateur",
  [AUDIT_EVENT_TYPES.PARENT_UNLINKED_FROM_STUDENT]: "Déliaison parent élève",
  [AUDIT_EVENT_TYPES.STUDENTS_IMPORTED]: "Import élèves année archivée",
  [AUDIT_EVENT_TYPES.STUDENT_TERMINAL_REENROLLED]: "Réinscription terminale élève",
  [AUDIT_EVENT_TYPES.FINANCE_PAYMENT_CREATED]: "Création paiement", [AUDIT_EVENT_TYPES.FINANCE_PAYMENT_UPDATED]: "Correction paiement", [AUDIT_EVENT_TYPES.FINANCE_PAYMENT_DELETED]: "Suppression paiement",
  [AUDIT_EVENT_TYPES.FINANCE_EXPENSE_CREATED]: "Création dépense", [AUDIT_EVENT_TYPES.FINANCE_EXPENSE_UPDATED]: "Modification dépense", [AUDIT_EVENT_TYPES.FINANCE_EXPENSE_DELETED]: "Suppression dépense",
});

const forbiddenMetadataKeys = /password|token|secret|prompt|content|medical|attachment/i;
export function sanitizeAuditMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata).filter(([key, value]) => !forbiddenMetadataKeys.test(key) && ["string", "number", "boolean"].includes(typeof value)).slice(0, 12));
}

export function buildServerAudit({ eventType, actor, schoolId, schoolYearId, resourceType, resourceId, metadata, id = randomUUID() }) {
  if (!Object.values(AUDIT_EVENT_TYPES).includes(eventType)) throw new Error(`Type d'audit serveur non autorisé: ${eventType}`);
  if (!actor?.uid || !actor?.role || !schoolId || !resourceType || !resourceId) throw new Error("Contexte d'audit serveur incomplet.");
  const action = labels[eventType];
  return { id, eventType, actorId: actor.uid, actorRole: actor.role, actorName: actor.name ?? actor.email ?? actor.uid, schoolId, ...(schoolYearId ? { schoolYearId } : {}), resourceType, resourceId, source: "server", metadata: sanitizeAuditMetadata(metadata), action, details: action, createdAt: FieldValue.serverTimestamp() };
}
