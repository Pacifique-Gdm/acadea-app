import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { BarChart3, BookOpen, CheckCircle2, Clock3, LogOut, Settings } from "lucide-react";
import { DisciplineAttendanceDrawer } from "../../components/discipline/DisciplineAttendanceDrawer";
import { AttendanceSettingsDrawer } from "../../components/discipline/AttendanceSettingsDrawer";
import { DisciplineHistoryDrawer } from "../../components/discipline/DisciplineHistoryDrawer";
import { DisciplineStatistics } from "../../components/discipline/DisciplineStatistics";
import { DisciplineStatus } from "../../components/discipline/DisciplineStatus";
import { NewSanctionDrawer } from "../../components/discipline/NewSanctionDrawer";
import { ValvesDrawerContent } from "../../components/valves/ValvesDrawerContent";
import type { ValveAttachmentDraft } from "../../components/valves/ValvesDrawerContent";
import type { ValveAttachmentListItem } from "../../components/valves/AttachmentsList";
import { AdminDrawer } from "../../components/ui";
import { completeDisciplineSanction, createDisciplineSanction, saveDisciplineAuditLog } from "../../services/discipline";
import { markConversationUnreadCountRead, persistMessageWithConversation } from "../../services/conversations";
import { canUseFirestoreData, persistFirestorePatch } from "../../services/firestoreData";
import { markNotificationsReadTargeted } from "../../services/notificationsPagination";
import { attendanceRecordId, attendanceStatusText, resolveAttendanceStatusForArrival } from "../../utils/attendance";
import { buildDisciplineStats } from "../../utils/disciplineStats";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { AppData, AppNotification, AppUser, AttendanceRecord, AttendanceSettings, AttendanceStatus, AuditLog, DisciplineSanction, Message, School, SchoolYear, Student, ValvePublication } from "../../types";

type DisciplineTab = "status" | "attendance" | "messages" | "menu";

type NewDisciplineSanctionFormInput = {
  students: Student[];
  reason: string;
  description: string;
  sanctionType: string;
  duration: number;
  startDate: string;
  expectedEndDate: string;
  observation: string;
};

type DisciplinePortalYearData = Pick<
  AppData,
  | "students"
  | "parents"
  | "users"
  | "feeTypes"
  | "payments"
  | "expenses"
  | "auditLogs"
  | "messages"
  | "valves"
  | "attendance"
  | "attendanceSettings"
  | "disciplineSanctions"
  | "notifications"
>;

type HeaderComponentProps = {
  user: AppUser;
  data: AppData;
  yearData: DisciplinePortalYearData;
  school: School;
  year: SchoolYear;
  unreadNotifications: number;
  notificationsOpen: boolean;
  isRefreshing: boolean;
  refreshError: string;
  onRefresh: () => void;
  onToggleNotifications: () => void;
  onCloseNotifications: () => void;
  onRealtimeNotifications: (notifications: AppNotification[]) => void;
  onRealtimeMessages: (messages: Message[]) => void;
};

type DisciplineBottomNavigationComponentProps = {
  activeTab: DisciplineTab;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onTab: (tab: DisciplineTab) => void;
};

type MessagesModuleComponentProps = {
  user: AppUser;
  data: AppData;
  yearData: DisciplinePortalYearData;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
};

export function DisciplinePortal({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  onRefresh,
  isRefreshing,
  refreshError,
  showInstallButton,
  onInstallPwa,
  onLogout,
  EnvironmentBannerComponent,
  HeaderComponent,
  DisciplineBottomNavigationComponent,
  MessagesModuleComponent,
  createId,
  createAuditLog,
  nextMessageThreadId,
  disciplineStudentName,
  disciplineClassName,
  disciplineSignalBody,
  selectAttendanceSettingsForYear,
  normalizeDisciplineReason,
  mergeNotificationsById,
  mergeMessagesById,
  getPublicationAttachmentDrafts,
  getPublicationDownloadAttachments,
  getValveAttachmentKey,
  validateValveAttachmentDrafts,
  getValvePublicationErrorMessage,
  getApproximateValveDocumentSize,
  maxValveDocumentBytes,
}: {
  user: AppUser;
  data: AppData;
  yearData: DisciplinePortalYearData;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  refreshError: string;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onLogout: () => void;
  EnvironmentBannerComponent: ComponentType;
  HeaderComponent: ComponentType<HeaderComponentProps>;
  DisciplineBottomNavigationComponent: ComponentType<DisciplineBottomNavigationComponentProps>;
  MessagesModuleComponent: ComponentType<MessagesModuleComponentProps>;
  createId: (prefix: string) => string;
  createAuditLog: (user: AppUser, schoolId: string, schoolYearId: string, action: string, details: string) => AuditLog;
  nextMessageThreadId: (messages: Message[], senderId: string, recipientParentId: Message["recipientParentId"], threadParentId?: string, preferredThreadId?: string) => string | null | undefined;
  disciplineStudentName: (student: Student) => string;
  disciplineClassName: (student: Pick<Student, "className" | "option">) => string;
  disciplineSignalBody: (sanction: DisciplineSanction) => string;
  selectAttendanceSettingsForYear: (settings: AttendanceSettings[], schoolId: string, schoolYearId: string) => AttendanceSettings | undefined;
  normalizeDisciplineReason: (value: string) => string;
  mergeNotificationsById: (currentItems: AppNotification[], nextItems: AppNotification[]) => AppNotification[];
  mergeMessagesById: (currentItems: Message[], nextItems: Message[]) => Message[];
  getPublicationAttachmentDrafts: (publication: ValvePublication) => ValveAttachmentDraft[];
  getPublicationDownloadAttachments: (publication: ValvePublication) => ValveAttachmentListItem[];
  getValveAttachmentKey: (attachment: Pick<ValveAttachmentDraft, "name" | "size" | "path" | "url">) => string;
  validateValveAttachmentDrafts: (attachments: ValveAttachmentDraft[]) => string;
  getValvePublicationErrorMessage: (error: unknown, fallback: string) => string;
  getApproximateValveDocumentSize: (publication: ValvePublication) => number;
  maxValveDocumentBytes: number;
}) {
  const [activeDisciplineTab, setActiveDisciplineTab] = useState<DisciplineTab>("status");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [newSanctionOpen, setNewSanctionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [attendanceSettingsOpen, setAttendanceSettingsOpen] = useState(false);
  const [disciplineValvesOpen, setDisciplineValvesOpen] = useState(false);
  const [selectedDisciplineStudentId, setSelectedDisciplineStudentId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const unread = yearData.notifications.filter((notification) => !notification.read).length;
  const stats = useMemo(() => buildDisciplineStats(yearData.disciplineSanctions), [yearData.disciplineSanctions]);
  const attendanceSettings = useMemo(
    () => selectAttendanceSettingsForYear(yearData.attendanceSettings, school.id, year.id),
    [school.id, selectAttendanceSettingsForYear, year.id, yearData.attendanceSettings],
  );

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  function createDisciplineAudit(action: string, details: string) {
    return createAuditLog(user, school.id, year.id, action, details);
  }

  function findDisciplineSignalParent(student: Student) {
    const parents = yearData.parents.filter(
      (parent) =>
        parent.schoolId === school.id &&
        (parent.id === student.parentId || parent.studentIds.includes(student.id)),
    );
    const dedupedParents = Array.from(new Map(parents.map((parent) => [parent.id, parent])).values());
    if (dedupedParents.length > 1) {
      console.warn("Plusieurs parents liés à l'élève pour le signalement disciplinaire.", {
        studentId: student.id,
        parentIds: dedupedParents.map((parent) => parent.id),
      });
    }
    const directParent = dedupedParents.find((parent) => parent.id === student.parentId);
    return directParent ?? dedupedParents[0];
  }

  async function persistDisciplineAudit(auditLog: AuditLog) {
    await saveDisciplineAuditLog(auditLog);
    return auditLog;
  }

  async function sendDisciplineSignalToParent(sanction: DisciplineSanction, student: Student, persistWithFirestore: boolean) {
    const parent = findDisciplineSignalParent(student);
    if (!parent) {
      const missingParentAudit = createDisciplineAudit("Parent introuvable pour signalement disciplinaire", `${sanction.studentName} - ${sanction.id}`);
      if (!persistWithFirestore) {
        return { status: "missing-parent" as const, auditLog: missingParentAudit };
      }
      try {
        const persistedAudit = await persistDisciplineAudit(missingParentAudit);
        return { status: "missing-parent" as const, auditLog: persistedAudit };
      } catch (error) {
        console.warn("Audit parent introuvable discipline impossible.", error);
        return { status: "missing-parent" as const };
      }
    }

    const createdAt = sanction.createdAt;
    const message: Message = {
      id: `msg-discipline-${sanction.id}`,
      schoolId: school.id,
      schoolYearId: year.id,
      senderId: user.id,
      recipientParentId: parent.id,
      schoolRecipient: "discipline",
      threadParentId: parent.id,
      threadId: nextMessageThreadId(yearData.messages, user.id, parent.id, parent.id) ?? createId("thread"),
      disciplineSanctionId: sanction.id,
      subject: `Signalement disciplinaire — ${sanction.studentName}`,
      body: disciplineSignalBody(sanction),
      createdAt,
    };
    const notification: AppNotification = {
      id: `notif-discipline-${sanction.id}`,
      schoolId: school.id,
      schoolYearId: year.id,
      recipientRole: "parent",
      parentId: parent.id,
      messageId: message.id,
      disciplineSanctionId: sanction.id,
      type: "message",
      title: "Signalement disciplinaire",
      body: `${sanction.studentName} : ${sanction.reason || sanction.sanctionType}`,
      createdAt,
      read: false,
    };
    const alreadyExists = data.messages.some((item) => item.id === message.id || item.disciplineSanctionId === sanction.id) ||
      data.notifications.some((item) => item.id === notification.id || item.disciplineSanctionId === sanction.id);
    if (alreadyExists) {
      return { status: "already-exists" as const };
    }

    if (!persistWithFirestore) {
      const notifiedAudit = createDisciplineAudit("Parent notifié pour sanction disciplinaire", `${sanction.studentName} - ${parent.fullName}`);
      return { status: "sent" as const, message, notification, auditLog: notifiedAudit };
    }

    try {
      const savedMessage = await persistMessageWithConversation({ user, message, notification, parentName: parent.fullName });
      if (savedMessage.alreadyExisted) {
        return { status: "already-exists" as const };
      }
      const notifiedAudit = createDisciplineAudit("Parent notifié pour sanction disciplinaire", `${sanction.studentName} - ${parent.fullName}`);
      try {
        const persistedAudit = await persistDisciplineAudit(notifiedAudit);
        return { status: "sent" as const, message: savedMessage, notification, auditLog: persistedAudit };
      } catch (auditError) {
        console.warn("Audit parent notifié discipline impossible.", auditError);
        return { status: "sent" as const, message: savedMessage, notification };
      }
    } catch (error) {
      console.warn("Signalement disciplinaire au parent impossible.", error);
      const failedAudit = createDisciplineAudit("Échec signalement disciplinaire", `${sanction.studentName} - ${parent.fullName}`);
      if (!persistWithFirestore) {
        return { status: "send-failed" as const, auditLog: failedAudit };
      }
      try {
        const persistedAudit = await persistDisciplineAudit(failedAudit);
        return { status: "send-failed" as const, auditLog: persistedAudit };
      } catch (auditError) {
        console.warn("Audit échec signalement discipline impossible.", auditError);
        return { status: "send-failed" as const };
      }
    }
  }

  async function markNotificationsRead(notificationId?: string) {
    updateData(
      {
        notifications: data.notifications.map((notification) =>
          notification.schoolId === school.id &&
          notification.schoolYearId === year.id &&
          (notificationId ? notification.id === notificationId : true)
            ? { ...notification, read: true }
            : notification,
        ),
      },
      { persist: false },
    );
    await markNotificationsReadTargeted(user, school.id, year.id, notificationId).catch((error) => {
      console.warn("Marquage ciblé des notifications discipline impossible.", error);
    });
    await markConversationUnreadCountRead(user, school.id, year.id).catch((error) => {
      console.warn("Remise à zéro des compteurs de conversation discipline impossible.", error);
    });
  }

  function closeNotifications() {
    setNotificationsOpen(false);
    void markNotificationsRead();
  }

  function toggleNotifications() {
    if (notificationsOpen) {
      closeNotifications();
      return;
    }
    setNotificationsOpen(true);
  }

  async function saveNewSanction(input: NewDisciplineSanctionFormInput) {
    const persistWithFirestore = canUseFirestoreData();
    const createdSanctions: DisciplineSanction[] = [];
    const createdMessages: Message[] = [];
    const createdNotifications: AppNotification[] = [];
    const createdAuditLogs: AuditLog[] = [];
    const failedStudentIds: string[] = [];
    let notifiedParents = 0;
    let missingParents = 0;
    let failedSignals = 0;
    let existingSignals = 0;

    for (const student of input.students) {
      const now = new Date().toISOString();
      const sanctionBase: Omit<DisciplineSanction, "recurrenceNumber"> = {
        id: createId("discipline"),
        schoolId: school.id,
        schoolYearId: year.id,
        studentId: student.id,
        studentName: disciplineStudentName(student),
        className: disciplineClassName(student),
        reason: input.reason,
        description: input.description,
        sanctionType: input.sanctionType,
        duration: input.duration,
        startDate: input.startDate,
        expectedEndDate: input.expectedEndDate,
        status: "active",
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        ...(input.observation ? { observation: input.observation } : {}),
      };
      const auditLog = createDisciplineAudit("Création sanction disciplinaire", `${sanctionBase.studentName} - ${sanctionBase.sanctionType}`);

      try {
        const savedSanction = persistWithFirestore
          ? await createDisciplineSanction({ sanction: sanctionBase, auditLog })
          : {
              ...sanctionBase,
              recurrenceNumber: [...data.disciplineSanctions, ...createdSanctions].filter(
                (sanction) =>
                  sanction.schoolId === school.id &&
                  sanction.schoolYearId === year.id &&
                  sanction.studentId === student.id &&
                  normalizeDisciplineReason(sanction.reason) === normalizeDisciplineReason(sanctionBase.reason),
              ).length,
            };
        const signalResult = await sendDisciplineSignalToParent(savedSanction, student, persistWithFirestore);
        createdSanctions.push(savedSanction);
        createdAuditLogs.push(auditLog);
        if (signalResult.auditLog) createdAuditLogs.push(signalResult.auditLog);
        if (signalResult.status === "sent") {
          notifiedParents += 1;
          if (signalResult.message) createdMessages.push(signalResult.message);
          if (signalResult.notification) createdNotifications.push(signalResult.notification);
        } else if (signalResult.status === "missing-parent") {
          missingParents += 1;
        } else if (signalResult.status === "already-exists") {
          existingSignals += 1;
        } else {
          failedSignals += 1;
        }
      } catch (error) {
        console.warn("Création de sanction impossible pour un élève.", { studentId: student.id, error });
        failedStudentIds.push(student.id);
      }
    }

    if (createdSanctions.length > 0 || createdMessages.length > 0 || createdNotifications.length > 0 || createdAuditLogs.length > 0) {
      updateData(
        {
          disciplineSanctions: [...createdSanctions, ...data.disciplineSanctions],
          messages: [...createdMessages, ...data.messages],
          notifications: [...createdNotifications, ...data.notifications],
          auditLogs: [...createdAuditLogs, ...data.auditLogs],
        },
        persistWithFirestore ? { persist: false } : undefined,
      );
    }

    const summaryParts = [];
    if (createdSanctions.length > 0) summaryParts.push(`${createdSanctions.length} sanction(s) enregistrée(s)`);
    if (notifiedParents > 0) summaryParts.push(`${notifiedParents} parent(s) notifié(s)`);
    if (existingSignals > 0) summaryParts.push(`${existingSignals} signalement(s) déjà existant(s)`);
    if (missingParents > 0) summaryParts.push(`${missingParents} parent(s) introuvable(s)`);
    if (failedSignals > 0) summaryParts.push(`${failedSignals} signalement(s) en échec`);
    if (failedStudentIds.length > 0) summaryParts.push(`${failedStudentIds.length} échec(s) de création`);
    setFeedback(summaryParts.length > 0 ? `${summaryParts.join(", ")}.` : "Sanction non enregistrée. Veuillez réessayer.");

    if (failedStudentIds.length === 0) {
      setNewSanctionOpen(false);
      return [];
    }
    return failedStudentIds;
  }

  async function completeSanction(sanction: DisciplineSanction) {
    if (sanction.status !== "active") {
      setFeedback("Cette sanction est déjà purgée.");
      return;
    }
    if (!confirm(`Marquer comme purgée la sanction de ${sanction.studentName} ?`)) return;
    const completedAt = new Date().toISOString();
    const auditLog = createDisciplineAudit("Clôture sanction disciplinaire", `${sanction.studentName} - ${sanction.sanctionType}`);
    try {
      let completedSanction: DisciplineSanction;
      if (canUseFirestoreData()) {
        completedSanction = await completeDisciplineSanction({
          sanction,
          completedAt,
          completedBy: user.id,
          completedByName: user.name,
          auditLog,
        });
        updateData(
          {
            disciplineSanctions: data.disciplineSanctions.map((item) => (item.id === completedSanction.id ? completedSanction : item)),
            auditLogs: [auditLog, ...data.auditLogs],
          },
          { persist: false },
        );
      } else {
        completedSanction = {
          ...sanction,
          status: "completed",
          actualEndDate: completedAt.slice(0, 10),
          completedAt,
          completedBy: user.id,
          completedByName: user.name,
        };
        updateData({
          disciplineSanctions: data.disciplineSanctions.map((item) => (item.id === completedSanction.id ? completedSanction : item)),
          auditLogs: [auditLog, ...data.auditLogs],
        });
      }
      setFeedback("Sanction marquée comme purgée.");
    } catch (error) {
      console.warn("Clôture de sanction impossible.", error);
      setFeedback("Impossible de clôturer la sanction. Veuillez réessayer.");
    }
  }

  async function saveManualAttendance(inputs: { studentId: string; attendanceDate: string; status: AttendanceStatus; manualReason: string }[]) {
    const now = new Date().toISOString();
    const recordedAt = new Date(now);
    const existingAttendanceIds = new Set(data.attendance.map((item) => item.id));
    const existingNotificationIds = new Set(data.notifications.map((item) => item.id));
    const records: AttendanceRecord[] = [];
    const notifications: AppNotification[] = [];
    const auditLogs: AuditLog[] = [];
    let existing = 0;
    let failed = 0;

    for (const input of inputs) {
      const student = yearData.students.find((item) => item.id === input.studentId && item.schoolId === school.id && item.schoolYearId === year.id);
      if (!student || !input.manualReason.trim()) {
        failed += 1;
        continue;
      }

      const recordId = attendanceRecordId(school.id, year.id, student.id, input.attendanceDate);
      if (existingAttendanceIds.has(recordId)) {
        existing += 1;
        continue;
      }
      const attendanceDateForStatus = new Date(`${input.attendanceDate}T${recordedAt.toTimeString().slice(0, 8)}`);
      const resolvedStatus = resolveAttendanceStatusForArrival(student, input.status, attendanceSettings, attendanceDateForStatus);

      const record: AttendanceRecord = {
        id: recordId,
        schoolId: school.id,
        schoolYearId: year.id,
        studentId: student.id,
        attendanceDate: input.attendanceDate,
        status: resolvedStatus,
        recordedAt: now,
        recordedBy: user.id,
        source: "manual",
        manualReason: input.manualReason,
      };
      records.push(record);
      existingAttendanceIds.add(recordId);
      auditLogs.push(createDisciplineAudit("Présence manuelle élève", `${disciplineStudentName(student)} - ${input.attendanceDate} - ${input.manualReason}`));

      const parent = findDisciplineSignalParent(student);
      const notificationId = `notif-${recordId}`;
      if (parent && !existingNotificationIds.has(notificationId)) {
        const attendanceDate = new Date(`${input.attendanceDate}T00:00:00`);
        const statusText = attendanceStatusText(resolvedStatus);
        notifications.push({
          id: notificationId,
          schoolId: school.id,
          schoolYearId: year.id,
          recipientRole: "parent",
          parentId: parent.id,
          studentId: student.id,
          studentName: disciplineStudentName(student),
          type: "attendance",
          title: "Présence enregistrée",
          body: `Votre enfant ${disciplineStudentName(student)} a été enregistré ${statusText} le ${attendanceDate.toLocaleDateString("fr-FR")} à ${recordedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`,
          createdAt: now,
          read: false,
        });
        existingNotificationIds.add(notificationId);
      }
    }

    if (records.length > 0 || auditLogs.length > 0 || notifications.length > 0) {
      if (canUseFirestoreData()) {
        await persistFirestorePatch({ attendance: records, auditLogs, notifications }, { throwOnError: true });
        updateData(
          {
            attendance: [...records, ...data.attendance.filter((item) => !records.some((record) => record.id === item.id))],
            notifications: [...notifications, ...data.notifications.filter((item) => !notifications.some((notification) => notification.id === item.id))],
            auditLogs: [...auditLogs, ...data.auditLogs],
          },
          { persist: false },
        );
      } else {
        updateData({
          attendance: [...records, ...data.attendance.filter((item) => !records.some((record) => record.id === item.id))],
          notifications: [...notifications, ...data.notifications.filter((item) => !notifications.some((notification) => notification.id === item.id))],
          auditLogs: [...auditLogs, ...data.auditLogs],
        });
      }
    }

    return { created: records.length, existing, failed };
  }

  async function saveAttendanceSettings(settings: AttendanceSettings) {
    const sameAttendanceSettingsScope = (item: AttendanceSettings) => item.schoolId === settings.schoolId && item.schoolYearId === settings.schoolYearId;
    if (canUseFirestoreData()) {
      await persistFirestorePatch({ attendanceSettings: [settings] }, { throwOnError: true });
      updateData(
        {
          attendanceSettings: [settings, ...data.attendanceSettings.filter((item) => !sameAttendanceSettingsScope(item))],
        },
        { persist: false },
      );
      return;
    }
    updateData({
      attendanceSettings: [settings, ...data.attendanceSettings.filter((item) => !sameAttendanceSettingsScope(item))],
    });
  }

  async function exportDisciplinePdf(filteredSanctions: DisciplineSanction[]) {
    const studentsById = new Map(yearData.students.map((student) => [student.id, student]));
    const sortedSanctions = [...filteredSanctions].sort(
      (first, second) => (second.createdAt || second.startDate).localeCompare(first.createdAt || first.startDate),
    );
    const filteredStats = buildDisciplineStats(sortedSanctions);
    await renderAcadPdfPreview({
      filename: `discipline-${year.name}.pdf`,
      title: "Rapport disciplinaire",
      school,
      year,
      subtitle: `Export du ${new Date().toLocaleString("fr-FR")}`,
      sections: [
        pdfSection(
          "Synthèse",
          pdfInfoGrid([
            { label: "Total sanctions", value: filteredStats.total },
            { label: "Sanctions en cours", value: filteredStats.active },
            { label: "Sanctions purgées", value: filteredStats.completed },
            { label: "Élèves sanctionnés", value: filteredStats.sanctionedStudents },
            { label: "Récidives", value: filteredStats.recurrences },
          ]),
        ),
        pdfSection(
          "Sanctions",
          pdfTable(
            [
              { header: "Élève", render: (sanction) => sanction.studentName },
              { header: "Matricule", render: (sanction) => studentsById.get(sanction.studentId)?.matricule ?? "—" },
              { header: "Classe", render: (sanction) => sanction.className },
              { header: "Motif", render: (sanction) => sanction.reason },
              { header: "Type", render: (sanction) => sanction.sanctionType },
              { header: "Description", render: (sanction) => sanction.description || "—" },
              { header: "Début", render: (sanction) => sanction.startDate },
              { header: "Fin prévue", render: (sanction) => sanction.expectedEndDate },
              { header: "Fin réelle", render: (sanction) => sanction.actualEndDate ?? "—" },
              { header: "Durée", render: (sanction) => `${sanction.duration} jour(s)`, align: "center" },
              { header: "Statut", render: (sanction) => (sanction.status === "completed" ? "Purgée" : "Sanction en cours") },
              { header: "Récidive", render: (sanction) => sanction.recurrenceNumber, align: "center" },
              { header: "Auteur", render: (sanction) => sanction.createdByName },
              { header: "Clôture", render: (sanction) => sanction.completedByName ?? "—" },
            ],
            sortedSanctions,
            "Aucune sanction enregistrée.",
          ),
        ),
      ],
    });
    if (canUseFirestoreData()) {
      const auditLog = createDisciplineAudit("Export PDF discipline", `${sortedSanctions.length} sanction(s) exportée(s)`);
      try {
        await saveDisciplineAuditLog(auditLog);
        updateData({ auditLogs: [auditLog, ...data.auditLogs] }, { persist: false });
      } catch (error) {
        console.warn("Audit export discipline impossible.", error);
      }
    }
  }

  const feedbackTone =
    feedback.includes("Impossible") || feedback.includes("n'a pas pu")
      ? "border-red-200 bg-red-50 text-red-700"
      : feedback.includes("aucun parent") || feedback.includes("déjà")
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-mint/30 bg-mint/10 text-mint";
  const disciplineMenuSections = [
    {
      id: "valves",
      title: "Valves",
      description: "Communiqués publiés par l'administration.",
      icon: BookOpen,
      onClick: () => setDisciplineValvesOpen(true),
    },
    {
      id: "history",
      title: "Historique",
      description: "Sanctions en cours et purgées.",
      icon: Clock3,
      onClick: () => setHistoryOpen(true),
    },
    {
      id: "stats",
      title: "Statistiques",
      description: "Synthèse locale des sanctions chargées.",
      icon: BarChart3,
      onClick: () => setStatsOpen(true),
    },
    {
      id: "attendance-settings",
      title: "Paramètres présence",
      description: "Heures limites de retard par section ou classe.",
      icon: Settings,
      onClick: () => setAttendanceSettingsOpen(true),
    },
  ];
  const selectedDisciplineStudentSanctions = selectedDisciplineStudentId
    ? yearData.disciplineSanctions
        .filter((sanction) => sanction.studentId === selectedDisciplineStudentId)
        .sort((first, second) => (second.createdAt || second.startDate).localeCompare(first.createdAt || first.startDate))
    : [];
  const selectedDisciplineStudentName = selectedDisciplineStudentSanctions[0]?.studentName ?? "Élève";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
      <EnvironmentBannerComponent />
      <HeaderComponent
        user={user}
        data={data}
        yearData={yearData}
        school={school}
        year={year}
        unreadNotifications={unread}
        notificationsOpen={notificationsOpen}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        onRefresh={onRefresh}
        onToggleNotifications={toggleNotifications}
        onCloseNotifications={closeNotifications}
        onRealtimeNotifications={(notifications) => {
          if (notifications.length === 0) return;
          updateData({ notifications: mergeNotificationsById(data.notifications, notifications) }, { persist: false });
        }}
        onRealtimeMessages={(messages) => {
          if (messages.length === 0) return;
          updateData({ messages: mergeMessagesById(data.messages, messages) }, { persist: false });
        }}
      />
      <main className="mx-auto grid w-full max-w-7xl min-w-0 flex-1 gap-4 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
        {feedback && <p className={`rounded border p-3 text-sm font-semibold ${feedbackTone}`}>{feedback}</p>}
        {activeDisciplineTab === "status" && (
          <DisciplineStatus students={yearData.students} sanctions={yearData.disciplineSanctions} onNewSanction={() => setNewSanctionOpen(true)} onOpenStudent={setSelectedDisciplineStudentId} onExportPdf={exportDisciplinePdf} />
        )}
        {activeDisciplineTab === "attendance" && (
          <DisciplineAttendanceDrawer
            students={yearData.students}
            attendance={yearData.attendance}
            settings={attendanceSettings}
            school={school}
            year={year}
            onSaveManualAttendance={saveManualAttendance}
          />
        )}
        {activeDisciplineTab === "messages" && (
          <MessagesModuleComponent user={user} data={data} yearData={yearData} school={school} year={year} updateData={updateData} />
        )}
        {activeDisciplineTab === "menu" && (
          <section className="grid min-w-0 gap-3">
            {disciplineMenuSections.map((section) => {
              const Icon = section.icon;
              return (
                <button key={section.id} onClick={section.onClick} className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint" type="button">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="break-words font-bold text-ink">{section.title}</h2>
                      <p className="mt-1 break-words text-sm text-slate-500">{section.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
            <div className="mt-2 border-t border-slate-200 pt-4">
              <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
                <LogOut className="h-4 w-4" /> Déconnexion
              </button>
            </div>
          </section>
        )}
      </main>
      <DisciplineBottomNavigationComponent
        activeTab={activeDisciplineTab}
        showInstallButton={showInstallButton}
        onInstallPwa={onInstallPwa}
        onTab={(tab) => {
          setNotificationsOpen(false);
          setActiveDisciplineTab(tab);
        }}
      />
      {newSanctionOpen && (
        <AdminDrawer title="Nouvelle sanction" onClose={() => setNewSanctionOpen(false)} closeLabel="Fermer la nouvelle sanction">
          <NewSanctionDrawer students={yearData.students} sanctions={yearData.disciplineSanctions} onCancel={() => setNewSanctionOpen(false)} onSave={saveNewSanction} />
        </AdminDrawer>
      )}
      {selectedDisciplineStudentId && (
        <AdminDrawer title={`Dossier disciplinaire - ${selectedDisciplineStudentName}`} onClose={() => setSelectedDisciplineStudentId(null)} closeLabel="Fermer le dossier disciplinaire">
          <div className="grid min-w-0 gap-3">
            {selectedDisciplineStudentSanctions.length === 0 && (
              <p className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">Aucune sanction enregistrée pour cet élève.</p>
            )}
            {selectedDisciplineStudentSanctions.map((sanction) => (
              <article key={sanction.id} className="min-w-0 rounded border border-slate-200 bg-white p-4 text-sm shadow-sm">
                <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words font-bold text-ink">{sanction.sanctionType}</h2>
                      <span className={`rounded px-2 py-1 text-xs font-bold ${sanction.status === "completed" ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
                        {sanction.status === "completed" ? "Purgée" : "Sanction en cours"}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-500">{sanction.className}</p>
                  </div>
                  {sanction.status === "active" && (
                    <button onClick={() => completeSanction(sanction)} className="primary-button w-full justify-center lg:w-auto" type="button">
                      <CheckCircle2 className="h-4 w-4" /> Marquer comme purgée
                    </button>
                  )}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Date</span><p className="mt-1 break-words text-ink">{(sanction.createdAt || sanction.startDate).slice(0, 10)}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Motif</span><p className="mt-1 break-words text-ink">{sanction.reason}</p></div>
                  <div className="rounded bg-slate-50 p-3 sm:col-span-2"><span className="font-semibold text-slate-600">Description</span><p className="mt-1 whitespace-pre-wrap break-words text-ink">{sanction.description || "Non renseigné"}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Type</span><p className="mt-1 break-words text-ink">{sanction.sanctionType}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Durée</span><p className="mt-1 break-words text-ink">{sanction.duration} jour(s)</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Date de début</span><p className="mt-1 break-words text-ink">{sanction.startDate}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Date prévue de fin</span><p className="mt-1 break-words text-ink">{sanction.expectedEndDate}</p></div>
                  {sanction.actualEndDate && <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Date réelle de fin</span><p className="mt-1 break-words text-ink">{sanction.actualEndDate}</p></div>}
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Statut</span><p className="mt-1 break-words text-ink">{sanction.status === "completed" ? "Purgée" : "Sanction en cours"}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Récidive</span><p className="mt-1 break-words text-ink">{sanction.recurrenceNumber}</p></div>
                  <div className="rounded bg-slate-50 p-3 sm:col-span-2"><span className="font-semibold text-slate-600">Observation</span><p className="mt-1 whitespace-pre-wrap break-words text-ink">{sanction.observation || "Non renseigné"}</p></div>
                </div>
              </article>
            ))}
          </div>
        </AdminDrawer>
      )}
      {historyOpen && (
        <AdminDrawer title="Historique disciplinaire" onClose={() => setHistoryOpen(false)} closeLabel="Fermer l'historique disciplinaire">
          <DisciplineHistoryDrawer sanctions={yearData.disciplineSanctions} />
        </AdminDrawer>
      )}
      {statsOpen && (
        <AdminDrawer title="Statistiques disciplinaires" onClose={() => setStatsOpen(false)} closeLabel="Fermer les statistiques disciplinaires">
          <DisciplineStatistics stats={stats} />
        </AdminDrawer>
      )}
      {attendanceSettingsOpen && (
        <AdminDrawer title="Paramètres présence" onClose={() => setAttendanceSettingsOpen(false)} closeLabel="Fermer les paramètres de présence">
          <AttendanceSettingsDrawer
            school={school}
            year={year}
            user={user}
            students={yearData.students}
            settings={attendanceSettings}
            onSave={saveAttendanceSettings}
          />
        </AdminDrawer>
      )}
      {disciplineValvesOpen && (
        <AdminDrawer title="Valves" onClose={() => setDisciplineValvesOpen(false)} closeLabel="Fermer les valves">
          <ValvesDrawerContent
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={year}
            updateData={updateData}
            canManage={false}
            valvesUploadsEnabled={false}
            createId={createId}
            createAuditLog={createAuditLog}
            getPublicationAttachmentDrafts={getPublicationAttachmentDrafts}
            getPublicationDownloadAttachments={getPublicationDownloadAttachments}
            getValveAttachmentKey={getValveAttachmentKey}
            validateValveAttachmentDrafts={validateValveAttachmentDrafts}
            getValvePublicationErrorMessage={getValvePublicationErrorMessage}
            getApproximateValveDocumentSize={getApproximateValveDocumentSize}
            maxValveDocumentBytes={maxValveDocumentBytes}
          />
        </AdminDrawer>
      )}
    </div>
  );
}
