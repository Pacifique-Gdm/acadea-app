import type { AppUser } from "../types";
import type { AppNotification, AttendanceRecord, DisciplineSanction, Message, Student, ValvePublication } from "../types";

export type PaymentRecordedPushData = {
  module: "payments";
  event: "payment_recorded";
  destination: "/dashboard";
  notificationId: string;
  schoolId: string;
  schoolYearId: string;
  parentId: string;
  studentId: string;
};

export function resolvePaymentRecordedDestination(user: AppUser, data: Record<string, unknown>) {
  if (user.status === "inactive" || user.role !== "parent") return null;
  if (!user.schoolId || !user.parentId) return null;
  if (data.module !== "payments" || data.event !== "payment_recorded" || data.destination !== "/dashboard") return null;
  if (data.schoolId !== user.schoolId || data.parentId !== user.parentId) return null;
  if (typeof data.schoolYearId !== "string" || typeof data.studentId !== "string" || typeof data.notificationId !== "string") return null;
  if (user.activeSchoolYearId && data.schoolYearId !== user.activeSchoolYearId) return null;
  if (user.studentIds?.length && !user.studentIds.includes(data.studentId)) return null;
  return "/dashboard" as const;
}

export type MessagePushData = {
  module: "messages";
  event: "school_message_received" | "parent_message_received";
  destination: "/dashboard";
  notificationId: string;
  messageId: string;
  schoolId: string;
  schoolYearId: string;
  parentId: string;
  schoolRecipient?: "admin" | "cashier" | "discipline" | "both";
};

export function resolveMessagePushDestination(user: AppUser, data: Record<string, unknown>, message?: Message, sender?: AppUser) {
  if (user.status === "inactive" || data.module !== "messages" || data.destination !== "/dashboard") return null;
  if (data.event !== "school_message_received" && data.event !== "parent_message_received") return null;
  if (typeof data.messageId !== "string" || typeof data.notificationId !== "string" || typeof data.schoolId !== "string" || typeof data.schoolYearId !== "string" || typeof data.parentId !== "string") return null;
  if (!user.schoolId || data.schoolId !== user.schoolId || (user.activeSchoolYearId && data.schoolYearId !== user.activeSchoolYearId)) return null;

  if (data.event === "school_message_received") {
    if (user.role !== "parent" || !user.parentId || data.parentId !== user.parentId) return null;
    if (message && (message.id !== data.messageId || message.schoolId !== data.schoolId || message.schoolYearId !== data.schoolYearId || message.recipientParentId !== user.parentId || message.threadParentId !== user.parentId)) return null;
    if (message && (!sender || !["school_admin", "cashier", "discipline_director"].includes(sender.role) || sender.status === "inactive" || sender.schoolId !== user.schoolId)) return null;
  } else {
    const allowedRoles = data.schoolRecipient === "admin"
      ? ["school_admin"]
      : data.schoolRecipient === "cashier"
        ? ["cashier"]
        : data.schoolRecipient === "discipline"
          ? ["discipline_director"]
          : data.schoolRecipient === "both"
            ? ["school_admin", "cashier"]
            : [];
    if (!allowedRoles.includes(user.role) || user.role === "super_admin") return null;
    if (message && (message.id !== data.messageId || message.schoolId !== data.schoolId || message.schoolYearId !== data.schoolYearId || message.recipientParentId !== "school" || message.threadParentId !== data.parentId || message.schoolRecipient !== data.schoolRecipient)) return null;
    if (message && (!sender || sender.role !== "parent" || sender.status === "inactive" || sender.schoolId !== user.schoolId || sender.parentId !== data.parentId)) return null;
  }
  return `/dashboard?push=message&messageId=${encodeURIComponent(data.messageId)}`;
}

export function canOpenMessageDeepLink(user: AppUser, message: Message, sender: AppUser | undefined) {
  const event = user.role === "parent" ? "school_message_received" : "parent_message_received";
  const parentId = message.threadParentId;
  if (!parentId) return false;
  return Boolean(resolveMessagePushDestination(user, {
    module: "messages",
    event,
    destination: "/dashboard",
    notificationId: "deep-link",
    messageId: message.id,
    schoolId: message.schoolId,
    schoolYearId: message.schoolYearId,
    parentId,
    schoolRecipient: message.schoolRecipient,
  }, message, sender));
}

export function resolveOperationalPushDestination(user: AppUser, data: Record<string, unknown>) {
  if (user.status === "inactive" || data.destination !== "/dashboard" || data.schoolId !== user.schoolId || (user.activeSchoolYearId && data.schoolYearId !== user.activeSchoolYearId)) return null;
  if (data.module === "attendance" && (data.event === "student_absent" || data.event === "student_late") && typeof data.attendanceId === "string" && typeof data.studentId === "string" && typeof data.parentId === "string") {
    if (user.role !== "parent" || user.parentId !== data.parentId) return null;
    return `/dashboard?push=attendance&attendanceId=${encodeURIComponent(data.attendanceId)}`;
  }
  if (data.module === "discipline" && data.event === "discipline_incident_created" && typeof data.disciplineSanctionId === "string" && typeof data.studentId === "string" && typeof data.parentId === "string") {
    if (user.role !== "parent" || user.parentId !== data.parentId) return null;
    return `/dashboard?push=discipline&disciplineSanctionId=${encodeURIComponent(data.disciplineSanctionId)}`;
  }
  if (data.module === "announcements" && data.event === "announcement_published" && typeof data.announcementId === "string" && user.role !== "super_admin") {
    return `/dashboard?push=announcement&announcementId=${encodeURIComponent(data.announcementId)}`;
  }
  return null;
}

export function canOpenOperationalDeepLink(
  user: AppUser,
  notification: AppNotification,
  resource: AttendanceRecord | DisciplineSanction | ValvePublication,
  student?: Student,
) {
  if (user.role === "study_director") return false;
  if (resource.schoolId !== user.schoolId || resource.schoolYearId !== user.activeSchoolYearId) return false;
  if (notification.schoolId !== resource.schoolId || notification.schoolYearId !== resource.schoolYearId) return false;
  if (notification.module === "attendance" && "attendanceDate" in resource) {
    return user.role === "parent" && user.parentId === notification.parentId && notification.attendanceId === resource.id && notification.studentId === resource.studentId && student?.id === resource.studentId && student.parentId === user.parentId;
  }
  if (notification.module === "discipline" && "sanctionType" in resource) {
    return user.role === "parent" && user.parentId === notification.parentId && notification.disciplineSanctionId === resource.id && notification.studentId === resource.studentId && student?.id === resource.studentId && student.parentId === user.parentId;
  }
  if (notification.module === "announcements" && "visibility" in resource && notification.announcementId === resource.id) {
    if (user.role === "super_admin" || !notification.audienceRoles?.includes(user.role)) return false;
    if (user.role === "parent") return Boolean(user.parentId && notification.audienceParentIds?.includes(user.parentId));
    return notification.audienceSchoolWide === true || notification.audienceRoles.includes(user.role);
  }
  return false;
}
