import type { AnnouncementRecord, AttendanceRecord, DisciplineRecord, OperationalDispatch, OperationalNotificationRecord, ParentRecord, PushTokenRecord, SchoolUserRecord, StudentRecord } from "./types.js";

export type OperationalRepository = {
  getAttendance(id: string): Promise<AttendanceRecord | null>;
  getDiscipline(id: string): Promise<DisciplineRecord | null>;
  getAnnouncement(id: string): Promise<AnnouncementRecord | null>;
  getStudent(id: string): Promise<StudentRecord | null>;
  getParent(id: string): Promise<ParentRecord | null>;
  findParentUsers(parentId: string, schoolId: string): Promise<SchoolUserRecord[]>;
  findSchoolUsers(schoolId: string, roles: string[]): Promise<SchoolUserRecord[]>;
  listPushTokens(userId: string): Promise<PushTokenRecord[]>;
};

const allowedAudienceRoles = ["parent", "school_admin", "cashier", "discipline_director"];

export function isOperationalNotification(value: Record<string, unknown>): value is Omit<OperationalNotificationRecord, "id"> {
  if (typeof value.schoolId !== "string" || typeof value.schoolYearId !== "string") return false;
  if (value.module === "attendance" && (value.event === "student_absent" || value.event === "student_late")) {
    return [value.attendanceId, value.studentId, value.parentId].every((item) => typeof item === "string" && Boolean(item));
  }
  if (value.module === "discipline" && value.event === "discipline_incident_created") {
    return [value.disciplineSanctionId, value.studentId, value.parentId].every((item) => typeof item === "string" && Boolean(item));
  }
  if (value.module === "announcements" && value.event === "announcement_published") {
    return typeof value.announcementId === "string" && Boolean(value.announcementId) && Array.isArray(value.audienceRoles) && Array.isArray(value.audienceParentIds) && typeof value.audienceSchoolWide === "boolean";
  }
  return false;
}

function activeForYear(user: SchoolUserRecord, schoolId: string, yearId: string) {
  return user.status !== "inactive" && user.schoolId === schoolId && (!user.activeSchoolYearId || user.activeSchoolYearId === yearId);
}

async function withTokens(users: SchoolUserRecord[], repository: OperationalRepository) {
  const recipients = await Promise.all(users.map(async (user) => {
    const seen = new Set<string>();
    const tokens = (await repository.listPushTokens(user.id)).filter((token) => {
      if (!token.active || token.userId !== user.id || !token.token || seen.has(token.token)) return false;
      seen.add(token.token);
      return true;
    });
    return { userId: user.id, tokens };
  }));
  return recipients.filter((recipient) => recipient.tokens.length > 0);
}

function parentOwnsStudent(parent: ParentRecord, student: StudentRecord) {
  return student.parentId === parent.id || parent.studentIds?.includes(student.id) === true;
}

async function resolveParent(notification: OperationalNotificationRecord, repository: OperationalRepository) {
  if (!notification.parentId || !notification.studentId) return null;
  const [student, parent, users] = await Promise.all([
    repository.getStudent(notification.studentId), repository.getParent(notification.parentId), repository.findParentUsers(notification.parentId, notification.schoolId),
  ]);
  if (!student || student.id !== notification.studentId || student.schoolId !== notification.schoolId || student.schoolYearId !== notification.schoolYearId) return null;
  if (!parent || parent.id !== notification.parentId || parent.status === "inactive" || parent.schoolId !== notification.schoolId || parent.schoolYearId !== notification.schoolYearId || !parentOwnsStudent(parent, student)) return null;
  return users.filter((user) => user.role === "parent" && user.parentId === parent.id && activeForYear(user, notification.schoolId, notification.schoolYearId));
}

function section(className = "") {
  if (className.includes("Maternelle")) return "Maternelle";
  if (className.includes("CTEB")) return "CTEB";
  if (className.includes("Humanit")) return "Secondaire";
  return "Primaire";
}

function parentCanSeeAnnouncement(publication: AnnouncementRecord, parent: ParentRecord, student: StudentRecord) {
  if (!parentOwnsStudent(parent, student)) return false;
  if (publication.visibility === "all_parents") return true;
  if (publication.visibility === "class") {
    const key = student.option?.trim() ? `${student.className}::option::${student.option.trim()}` : student.className;
    return publication.targetClassKey === key;
  }
  return publication.visibility === section(student.className);
}

export async function resolveOperationalRecipients(notification: OperationalNotificationRecord, repository: OperationalRepository): Promise<OperationalDispatch | null> {
  if (notification.module === "attendance") {
    const attendance = notification.attendanceId ? await repository.getAttendance(notification.attendanceId) : null;
    const expectedStatus = notification.event === "student_absent" ? "absent" : "late";
    if (!attendance || attendance.id !== notification.attendanceId || attendance.studentId !== notification.studentId || attendance.schoolId !== notification.schoolId || attendance.schoolYearId !== notification.schoolYearId || attendance.status !== expectedStatus) return null;
    const parents = await resolveParent(notification, repository);
    if (!parents) return null;
    return { module: "attendance", event: notification.event, recipients: await withTokens(parents, repository) };
  }
  if (notification.module === "discipline") {
    const discipline = notification.disciplineSanctionId ? await repository.getDiscipline(notification.disciplineSanctionId) : null;
    if (!discipline || discipline.id !== notification.disciplineSanctionId || discipline.studentId !== notification.studentId || discipline.schoolId !== notification.schoolId || discipline.schoolYearId !== notification.schoolYearId) return null;
    const parents = await resolveParent(notification, repository);
    if (!parents) return null;
    return { module: "discipline", event: "discipline_incident_created", recipients: await withTokens(parents, repository) };
  }

  const announcement = notification.announcementId ? await repository.getAnnouncement(notification.announcementId) : null;
  if (!announcement || announcement.id !== notification.announcementId || announcement.schoolId !== notification.schoolId || announcement.schoolYearId !== notification.schoolYearId) return null;
  const roles = [...new Set(notification.audienceRoles ?? [])];
  if (roles.length === 0 || roles.some((role) => !allowedAudienceRoles.includes(role)) || roles.includes("super_admin")) return null;
  const users: SchoolUserRecord[] = [];
  if (notification.audienceSchoolWide) {
    users.push(...await repository.findSchoolUsers(notification.schoolId, roles));
  } else if (roles.includes("parent")) {
    const parentIds = [...new Set(notification.audienceParentIds ?? [])];
    if (parentIds.length === 0) return null;
    for (const parentId of parentIds) {
      const parent = await repository.getParent(parentId);
      if (!parent || parent.status === "inactive" || parent.schoolId !== notification.schoolId || parent.schoolYearId !== notification.schoolYearId) continue;
      const studentIds = parent.studentIds ?? [];
      const students = await Promise.all(studentIds.map((id) => repository.getStudent(id)));
      if (!students.some((student) => student && student.schoolId === notification.schoolId && student.schoolYearId === notification.schoolYearId && parentCanSeeAnnouncement(announcement, parent, student))) continue;
      users.push(...await repository.findParentUsers(parentId, notification.schoolId));
    }
  }
  const staffRoles = roles.filter((role) => role !== "parent");
  if (!notification.audienceSchoolWide && staffRoles.length > 0) users.push(...await repository.findSchoolUsers(notification.schoolId, staffRoles));
  const authorized = Array.from(new Map(users.filter((user) => allowedAudienceRoles.includes(user.role ?? "") && roles.includes(user.role ?? "") && user.role !== "super_admin" && activeForYear(user, notification.schoolId, notification.schoolYearId)).map((user) => [user.id, user])).values());
  return { module: "announcements", event: "announcement_published", recipients: await withTokens(authorized, repository) };
}
