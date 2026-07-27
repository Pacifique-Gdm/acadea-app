import type {
  ParentRecord,
  ParentUserRecord,
  PaymentRecordedNotification,
  PushTokenRecord,
  ResolvedPaymentRecipient,
  StudentRecord,
} from "./types.js";

export type PaymentRecipientRepository = {
  getParent(parentId: string): Promise<ParentRecord | null>;
  getStudent(studentId: string): Promise<StudentRecord | null>;
  findParentUsers(parentId: string, schoolId: string): Promise<ParentUserRecord[]>;
  listPushTokens(userId: string): Promise<PushTokenRecord[]>;
};

export function isPaymentRecordedNotification(value: Record<string, unknown>): value is Omit<PaymentRecordedNotification, "id"> {
  return (
    value.module === "payments" &&
    value.event === "payment_recorded" &&
    value.destination === "/dashboard" &&
    value.recipientRole === "parent" &&
    value.type === "payment" &&
    typeof value.schoolId === "string" &&
    typeof value.schoolYearId === "string" &&
    typeof value.parentId === "string" &&
    typeof value.studentId === "string"
  );
}

export async function resolvePaymentRecipient(
  notification: PaymentRecordedNotification,
  repository: PaymentRecipientRepository,
): Promise<ResolvedPaymentRecipient[]> {
  const [parent, student, users] = await Promise.all([
    repository.getParent(notification.parentId),
    repository.getStudent(notification.studentId),
    repository.findParentUsers(notification.parentId, notification.schoolId),
  ]);

  if (!parent || parent.status === "inactive" || parent.schoolId !== notification.schoolId || parent.schoolYearId !== notification.schoolYearId) return [];
  if (!student || student.schoolId !== notification.schoolId || student.schoolYearId !== notification.schoolYearId) return [];
  const parentOwnsStudent = student.parentId === parent.id || parent.studentIds?.includes(student.id) === true;
  if (!parentOwnsStudent) return [];

  const authorizedUsers = users.filter(
    (user) =>
      user.role === "parent" &&
      user.status !== "inactive" &&
      user.schoolId === notification.schoolId &&
      user.parentId === notification.parentId &&
      (!user.activeSchoolYearId || user.activeSchoolYearId === notification.schoolYearId),
  );

  const recipients = await Promise.all(
    authorizedUsers.map(async (user) => {
      const tokens = await repository.listPushTokens(user.id);
      const seen = new Set<string>();
      return {
        userId: user.id,
        tokens: tokens.filter((item) => {
          if (!item.active || item.userId !== user.id || !item.token || seen.has(item.token)) return false;
          seen.add(item.token);
          return true;
        }),
      };
    }),
  );
  return recipients.filter((recipient) => recipient.tokens.length > 0);
}
