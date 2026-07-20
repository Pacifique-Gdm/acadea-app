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

export function buildActivityHistoryItems(user: AppUser, data: AppData, yearData: ActivityHistoryYearData, role: "admin" | "cashier" | "parent") {
  const usersById = new Map(data.users.map((item) => [item.id, item]));
  const parentsById = new Map(yearData.parents.map((item) => [item.id, item]));
  const indexes = buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments);
  const auditActionsRepresentedByBusinessData = new Set(["Création paiement", "Création dépense", "Création sanction disciplinaire"]);
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
      if (isSessionAuditAction(log.action)) return false;
      if (role === "admin" && auditActionsRepresentedByBusinessData.has(log.action)) return false;
      const actor = usersById.get(log.actorId);
      const warningDetails = parseWarningDetails(log.details);
      if (warningDetails && role === "parent") return false;
      if (role === "admin") return log.actorId === user.id || actor?.role === "cashier";
      if (role === "cashier") return log.actorId === user.id;
      return log.actorId === user.id;
    })
    .map<ActivityHistoryItem>((log) => {
      const warningDetails = parseWarningDetails(log.details);
      if (warningDetails) {
        return {
          id: `audit-${log.id}`,
          type: "warning",
          title: "Campagne d'avertissement paiement",
          actorName: log.actorName,
          details:
            `Frais : ${warningDetails.feeName ?? "-"} · Montant requis : $${Number(warningDetails.requiredAmount ?? 0).toFixed(2)} · Date limite : ${warningDetails.deadline ?? "-"} · Élèves concernés : ${warningDetails.affectedStudents ?? 0} · Parents notifiés : ${warningDetails.notifiedParents ?? 0} · Avertissements envoyés : ${warningDetails.sentMessages ?? 0} · Statut : ${warningDetails.status ?? "Succès"}`,
          createdAt: log.createdAt,
        };
      }
      return {
        id: `audit-${log.id}`,
        type: "activity",
        title: log.action,
        actorName: log.actorName,
        details: log.details ?? "",
        createdAt: log.createdAt,
      };
    });

  const paymentItems =
    role === "admin"
      ? yearData.payments.map<ActivityHistoryItem>((payment) => {
          const student = indexes.studentsById.get(payment.studentId);
          const fee = indexes.feeTypesById.get(payment.feeTypeId);
          const studentName = student ? `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim() : "Élève non renseigné";
          return {
            id: `payment-${payment.id}`,
            type: "payment",
            title: "Paiement",
            actorName: payment.cashierName || "Caissier",
            details:
              `Élève : ${studentName} · Classe : ${student ? formatStudentClassName(student) : "-"} · Frais : ${fee?.name ?? "Frais"} · Montant : ${money(payment.amount)} · Date : ${payment.paidAt} · Heure : ${payment.createdAt ? new Date(payment.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"} · Enregistré par : ${payment.cashierName || "-"} · Référence : ${payment.receiptNumber ?? payment.id}`,
            createdAt: payment.createdAt ?? payment.paidAt,
          };
        })
      : [];

  const expenseItems =
    role === "admin"
      ? yearData.expenses.map<ActivityHistoryItem>((expense) => ({
          id: `expense-${expense.id}`,
          type: "expense",
          title: "Dépense",
          actorName: expense.cashierName || "Caissier",
          details:
            `Motif : ${expense.category} · Description : ${expense.description || "-"} · Montant : ${money(expense.amount)} · Date : ${expense.spentAt} · Heure : ${expense.createdAt ? new Date(expense.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"} · Enregistrée par : ${expense.cashierName || "-"} · Référence : ${expense.reference ?? expense.id}`,
          createdAt: expense.createdAt ?? expense.spentAt,
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
            `Élève : ${sanction.studentName} · Classe : ${sanction.className} · Motif : ${sanction.reason} · Type : ${sanction.sanctionType} · Début : ${sanction.startDate} · Fin prévue : ${sanction.expectedEndDate} · Fin réelle : ${sanction.actualEndDate ?? "-"} · Statut : ${sanction.status === "completed" ? "Purgée" : "Sanction en cours"} · Récidive : ${sanction.recurrenceNumber} · Créée par : ${sanction.createdByName || "-"} · Clôturée par : ${sanction.completedByName ?? "-"}`,
          createdAt: sanction.createdAt ?? sanction.startDate,
        }))
      : [];

  const messageItems = yearData.messages
    .filter((message) => {
      if (role === "admin") return message.recipientParentId === "school";
      if (role === "parent") return message.threadParentId === user.parentId || message.recipientParentId === user.parentId;
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
        createdAt: message.createdAt,
      };
    });

  function itemTimestamp(item: ActivityHistoryItem) {
    const timestamp = new Date(item.createdAt).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  return [...auditItems, ...messageItems, ...paymentItems, ...expenseItems, ...disciplineItems].sort(
    (a, b) => itemTimestamp(b) - itemTimestamp(a) || b.createdAt.localeCompare(a.createdAt),
  );
}
