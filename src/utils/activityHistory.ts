import type { AppData, AppUser, AuditLog, DisciplineSanction, Expense, FeeType, Message, ParentProfile, Payment, Student } from "../types";
import { isSessionAuditAction } from "./audit";
import { formatSchoolRecipientLabel } from "./messages";
import { money } from "./pdf";
import { buildSchoolYearDataIndexes } from "./dataIndexes";
import { formatStudentClassName } from "./studentClasses";
import { expenseCategoryLabel } from "./expenseCategory";

export type ActivityHistoryItem = {
  id: string;
  type: "activity" | "message" | "warning" | "payment" | "expense" | "discipline" | "student";
  title: string;
  actorName: string;
  /** Compte qui a fait l'action, quand il est connu (filtre « Utilisateur »). */
  actorId?: string;
  details: string;
  createdAt: string;
};

export type ActivityHistoryYearData = {
  students: Student[];
  parents: ParentProfile[];
  users?: AppUser[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
  auditLogs: AuditLog[];
  messages: Message[];
  disciplineSanctions: DisciplineSanction[];
};

type FirestoreTimestampLike = { toMillis?: () => number; toDate?: () => Date; seconds?: number };

export function activityTimestamp(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  if (value && typeof value === "object") {
    const timestamp = value as FirestoreTimestampLike;
    if (typeof timestamp.toMillis === "function") {
      const milliseconds = timestamp.toMillis();
      return Number.isFinite(milliseconds) ? milliseconds : 0;
    }
    if (typeof timestamp.toDate === "function") return activityTimestamp(timestamp.toDate());
    if (typeof timestamp.seconds === "number") return activityTimestamp(timestamp.seconds * 1000);
  }
  return 0;
}

export function normalizeActivityTimestamp(value: unknown) {
  const timestamp = activityTimestamp(value);
  return timestamp > 0 ? new Date(timestamp).toISOString() : "";
}

export function formatActivityDateTime(value: unknown) {
  const timestamp = activityTimestamp(value);
  return timestamp > 0 ? new Date(timestamp).toLocaleString("fr-FR") : "Date inconnue";
}

export function isSuperAdministratorAuditLog(log: AuditLog) {
  if (log.actorRole === "super_admin") return true;
  const explicitInformation = [log.actorName, log.action, log.details, log.eventType, JSON.stringify(log.metadata ?? {})]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
  return /\bsuper[\s_-]*(?:administrateur|administratrice|admin)\b/.test(explicitInformation);
}

function formatActivityTime(value: unknown) {
  const timestamp = activityTimestamp(value);
  return timestamp > 0 ? new Date(timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-";
}

function auditAction(log: AuditLog) {
  const action = typeof log.action === "string" ? log.action.trim() : "";
  const legacyAction = typeof log.eventType === "string" ? log.eventType.trim() : "";
  return action || legacyAction || "Activité enregistrée";
}

export function buildActivityHistoryItems(user: AppUser, data: AppData, yearData: ActivityHistoryYearData, role: "admin" | "cashier" | "parent" | "secretary" | "teacher" | "study_director") {
  const usersById = new Map(data.users.map((item) => [item.id, item]));
  const parentsById = new Map(yearData.parents.map((item) => [item.id, item]));
  const indexes = buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments);
  const auditActionsRepresentedByBusinessData = new Set(["Création paiement", "Création dépense", "Création sanction disciplinaire"]);
  const visiblePaymentRecords = yearData.payments.filter((payment) => role === "admin" || (role === "cashier" && payment.createdBy === user.id));
  const visibleExpenseRecords = yearData.expenses.filter((expense) => role === "admin" || (role === "cashier" && expense.createdBy === user.id));
  const cashierBusinessResources = new Set([
    ...visiblePaymentRecords.map((payment) => `payment:${payment.id}`),
    ...visibleExpenseRecords.map((expense) => `expense:${expense.id}`),
  ]);
  const parseWarningDetails = (details?: string) => {
    if (!details) return null;
    try {
      const parsed = JSON.parse(details) as {
        kind?: string;
        campaignId?: string;
        feeName?: string;
        requiredAmount?: number;
        deadline?: string;
        affectedStudents?: number;
        notifiedParents?: number;
        sentMessages?: number;
        status?: string;
      };
      return parsed.kind === "payment_warning_campaign" ? parsed : null;
    } catch {
      return null;
    }
  };
  const auditItems = yearData.auditLogs
    .filter((log) => {
      const action = auditAction(log);
      if (isSessionAuditAction(action)) return false;
      if (role === "admin" && auditActionsRepresentedByBusinessData.has(action)) return false;
      if (
        role === "cashier"
        && auditActionsRepresentedByBusinessData.has(action)
        && log.resourceType
        && log.resourceId
        && cashierBusinessResources.has(`${log.resourceType}:${log.resourceId}`)
      ) return false;
      const actor = usersById.get(log.actorId);
      const warningDetails = parseWarningDetails(log.details);
      if (warningDetails && role === "parent") return false;
      // Administrateur : toutes les activités des utilisateurs de son école (secrétaire, caissier, directeurs, enseignants…).
      if (role === "admin") return log.schoolId === user.schoolId || log.actorId === user.id || actor?.role === "cashier" || actor?.role === "discipline_director";
      if (role === "study_director") return log.subjectUserId ? log.schoolId === user.schoolId : log.actorId === user.id;
      if (role === "teacher") return log.subjectUserId ? log.subjectUserId === user.id && log.schoolId === user.schoolId : log.actorId === user.id;
      if (role === "cashier" || role === "secretary") return log.actorId === user.id;
      return log.actorId === user.id;
    })
    .map<ActivityHistoryItem>((log) => {
      const action = auditAction(log);
      const warningDetails = parseWarningDetails(log.details);
      if (warningDetails) {
        return {
          id: `audit-${log.id}`,
          type: "warning",
          title: "Campagne d'avertissement paiement",
          actorName: log.actorName,
          details:
            `Frais : ${warningDetails.feeName ?? "-"} · Montant requis : $${Number(warningDetails.requiredAmount ?? 0).toFixed(2)} · Date limite : ${warningDetails.deadline ?? "-"} · Élèves concernés : ${warningDetails.affectedStudents ?? 0} · Parents notifiés : ${warningDetails.notifiedParents ?? 0} · Avertissements envoyés : ${warningDetails.sentMessages ?? 0} · Statut : ${warningDetails.status ?? "Succès"}`,
          createdAt: normalizeActivityTimestamp(log.createdAt),
        };
      }
      if (log.eventType === "student.created" || log.eventType === "student.updated" || log.eventType === "student.class_changed") {
        const meta = log.metadata ?? {};
        const who = [meta.student, meta.matricule ? `(${meta.matricule})` : ""].filter(Boolean).join(" ");
        return {
          id: `audit-${log.id}`,
          type: "student",
          title: action,
          actorName: log.actorName || "Utilisateur",
          actorId: log.actorId,
          details: [who ? `Élève : ${who}` : "", typeof meta.changes === "string" && meta.changes ? meta.changes : meta.fields ? `Champs modifiés : ${meta.fields}` : ""].filter(Boolean).join(" · "),
          createdAt: normalizeActivityTimestamp(log.createdAt),
        };
      }
      return {
        id: `audit-${log.id}`,
        actorId: log.actorId,
        type: action.toLocaleLowerCase("fr").includes("sanction") ? "discipline" : "activity",
        title: action,
        actorName: log.actorName || "Utilisateur",
        details: `${log.subjectUserId && log.subjectUserId !== log.actorId ? `Enseignant : ${usersById.get(log.subjectUserId)?.name ?? "Enseignant concerné"} · ` : ""}${log.details ?? ""}`,
        createdAt: normalizeActivityTimestamp(log.createdAt),
      };
    });

  const paymentItems =
    role === "admin" || role === "cashier"
      ? visiblePaymentRecords.map<ActivityHistoryItem>((payment) => {
          const student = indexes.studentsById.get(payment.studentId);
          const fee = indexes.feeTypesById.get(payment.feeTypeId);
          const studentName = student ? `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim() : "Élève non renseigné";
          return {
            id: `payment-${payment.id}`,
            actorId: payment.createdBy,
            type: "payment",
            title: "Paiement",
            actorName: payment.cashierName || "Caissier",
            details:
              `Élève : ${studentName} · Classe : ${student ? formatStudentClassName(student) : "-"} · Frais : ${fee?.name ?? "Frais"} · Montant : ${money(payment.amount)} · Date : ${payment.paidAt} · Heure : ${formatActivityTime(payment.createdAt)} · Enregistré par : ${payment.cashierName || "-"} · Référence : ${payment.receiptNumber ?? payment.id}`,
            createdAt: normalizeActivityTimestamp(payment.createdAt ?? payment.paidAt),
          };
        })
      : [];

  const expenseItems =
    role === "admin" || role === "cashier"
      ? visibleExpenseRecords.map<ActivityHistoryItem>((expense) => ({
          id: `expense-${expense.id}`,
          actorId: expense.createdBy,
          type: "expense",
          title: "Dépense",
          actorName: expense.cashierName || "Caissier",
          details:
            `Motif : ${expenseCategoryLabel(expense.category, expense.categoryDetail)} · Description : ${expense.description || "-"} · Montant : ${money(expense.amount)} · Date : ${expense.spentAt} · Heure : ${formatActivityTime(expense.createdAt)} · Enregistrée par : ${expense.cashierName || "-"} · Référence : ${expense.reference ?? expense.id}`,
          createdAt: normalizeActivityTimestamp(expense.createdAt ?? expense.spentAt),
        }))
      : [];

  const disciplineItems =
    role === "admin"
      ? yearData.disciplineSanctions.map<ActivityHistoryItem>((sanction) => ({
          id: `discipline-${sanction.id}`,
          type: "discipline",
          title: "Sanction disciplinaire",
          actorName: sanction.createdByName || "Directeur de Discipline",
          details:
            `Élève : ${sanction.studentName} · Classe : ${sanction.className} · Motif : ${sanction.reason} · Type : ${sanction.sanctionType} · Début : ${sanction.startDate} · Fin prévue : ${sanction.expectedEndDate} · Fin réelle : ${sanction.actualEndDate ?? "-"} · Statut : ${sanction.status === "completed" ? "Purgée" : "Sanction en cours"} · Récidive : ${sanction.recurrenceNumber} · Créée par : ${sanction.createdByName || "-"} · Clôturée par : ${sanction.completedByName ?? "-"} · Année scolaire : ${sanction.schoolYearId} · École : ${sanction.schoolId} · Identifiant : ${sanction.id}`,
          createdAt: normalizeActivityTimestamp(sanction.createdAt ?? sanction.startDate),
        }))
      : [];

  const messageItems = yearData.messages
    .filter((message) => {
      if (role === "admin") return message.recipientParentId === "school";
      if (role === "parent") return message.threadParentId === user.parentId || message.recipientParentId === user.parentId;
      if (role === "cashier" || role === "secretary" || role === "teacher" || role === "study_director") return message.senderId === user.id || message.participantIds?.includes(user.id);
      return false;
    })
    .map<ActivityHistoryItem>((message) => {
      const sender = usersById.get(message.senderId);
      const senderParent = sender?.parentId ? parentsById.get(sender.parentId) : message.threadParentId ? parentsById.get(message.threadParentId) : undefined;
      const senderName = sender?.role === "parent" ? senderParent?.fullName ?? sender.name : sender?.name ?? (senderParent?.fullName ?? "École");
      const recipientName =
        message.recipientParentId === "school"
          ? formatSchoolRecipientLabel(message.schoolRecipient)
          : message.recipientParentId === "all"
            ? "Tous les parents"
            : parentsById.get(message.recipientParentId)?.fullName ?? "Parent";
      const isSentByCurrentUser = message.senderId === user.id;
      return {
        id: `message-${message.id}`,
        type: "message",
        title: isSentByCurrentUser ? "Message envoyé" : "Message reçu",
        actorName: senderName,
        details: `Expéditeur : ${senderName} · Destinataire : ${recipientName} · Statut : ${isSentByCurrentUser ? "envoyé" : "reçu"}`,
        createdAt: normalizeActivityTimestamp(message.createdAt),
      };
    });

  return [...auditItems, ...messageItems, ...paymentItems, ...expenseItems, ...disciplineItems].sort(
    (a, b) => activityTimestamp(b.createdAt) - activityTimestamp(a.createdAt),
  );
}

/** Nombre d'activités affichées par page dans le drawer « Historique » (bouton « Voir plus »). */
export const ACTIVITY_HISTORY_PAGE_SIZE = 30;

export type ActivityHistoryFilters = {
  query?: string;
  type?: "all" | ActivityHistoryItem["type"];
  /** Nom de l'utilisateur ("" = tous). */
  actor?: string;
  /** Période, dates incluses, au format AAAA-MM-JJ ("" = sans borne). */
  from?: string;
  to?: string;
};

/** Filtres simples du drawer « Historique » : texte, type d'activité, utilisateur et période. */
export function filterActivityHistoryItems(items: ActivityHistoryItem[], filters: ActivityHistoryFilters) {
  const query = filters.query?.trim().toLowerCase() ?? "";
  const fromTime = filters.from ? Date.parse(`${filters.from}T00:00:00`) : Number.NEGATIVE_INFINITY;
  const toTime = filters.to ? Date.parse(`${filters.to}T23:59:59.999`) : Number.POSITIVE_INFINITY;
  return items.filter((item) => {
    if (filters.type && filters.type !== "all" && item.type !== filters.type) return false;
    if (filters.actor && item.actorName !== filters.actor) return false;
    const time = activityTimestamp(item.createdAt);
    if ((filters.from || filters.to) && (!Number.isFinite(time) || time < fromTime || time > toTime)) return false;
    return !query || `${item.title} ${item.actorName} ${item.details}`.toLowerCase().includes(query);
  });
}

/** Utilisateurs présents dans l'historique, triés par nom, pour le filtre « Utilisateur ». */
export function activityHistoryActors(items: ActivityHistoryItem[]) {
  return [...new Set(items.map((item) => item.actorName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
}
