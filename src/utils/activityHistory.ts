import type { AppData, AppUser, AuditLog, DisciplineSanction, Expense, FeeType, Message, ParentProfile, Payment, Student } from "../types";
import { isSessionAuditAction } from "./audit";
import { formatSchoolRecipientLabel } from "./messages";
import { money } from "./pdf";
import { buildSchoolYearDataIndexes } from "./dataIndexes";
import { formatStudentClassName } from "./studentClasses";

export type ActivityHistoryItem = {
  id: string;
  type: "activity" | "message" | "warning" | "payment" | "expense" | "discipline";
  title: string;
  actorName: string;
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
      if (role === "admin") return log.actorId === user.id || actor?.role === "cashier" || actor?.role === "discipline_director";
      if (role === "cashier" || role === "secretary" || role === "teacher" || role === "study_director") return log.actorId === user.id;
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
      return {
        id: `audit-${log.id}`,
        type: action.toLocaleLowerCase("fr").includes("sanction") ? "discipline" : "activity",
        title: action,
        actorName: log.actorName || "Utilisateur",
        details: log.details ?? "",
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
          type: "expense",
          title: "Dépense",
          actorName: expense.cashierName || "Caissier",
          details:
            `Motif : ${expense.category} · Description : ${expense.description || "-"} · Montant : ${money(expense.amount)} · Date : ${expense.spentAt} · Heure : ${formatActivityTime(expense.createdAt)} · Enregistrée par : ${expense.cashierName || "-"} · Référence : ${expense.reference ?? expense.id}`,
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
