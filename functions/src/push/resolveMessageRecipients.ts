import type {
  MessageNotificationRecord,
  MessageRecord,
  MessageRecipient,
  ParentRecord,
  PushTokenRecord,
  ResolvedMessageDispatch,
  SchoolUserRecord,
} from "./types.js";

export type MessageRecipientRepository = {
  getMessage(messageId: string): Promise<MessageRecord | null>;
  getParent(parentId: string): Promise<ParentRecord | null>;
  getUser(userId: string): Promise<SchoolUserRecord | null>;
  findParentUsers(parentId: string, schoolId: string): Promise<SchoolUserRecord[]>;
  findSchoolUsers(schoolId: string, roles: string[]): Promise<SchoolUserRecord[]>;
  listPushTokens(userId: string): Promise<PushTokenRecord[]>;
};

const schoolRolesByRecipient: Record<MessageRecipient, string[]> = {
  admin: ["school_admin"],
  cashier: ["cashier"],
  discipline: ["discipline_director"],
  both: ["school_admin", "cashier"],
};

export function isMessageNotification(value: Record<string, unknown>): value is Omit<MessageNotificationRecord, "id"> {
  if (value.module === "discipline" || typeof value.disciplineSanctionId === "string") return false;
  if (
    value.type !== "message" ||
    (value.recipientRole !== "parent" && value.recipientRole !== "school") ||
    typeof value.schoolId !== "string" ||
    typeof value.schoolYearId !== "string" ||
    typeof value.messageId !== "string" ||
    !value.messageId
  ) return false;
  if (value.recipientRole === "parent") return typeof value.parentId === "string" && Boolean(value.parentId);
  return value.schoolRecipient === "admin" || value.schoolRecipient === "cashier" || value.schoolRecipient === "discipline" || value.schoolRecipient === "both";
}

function activeForYear(user: SchoolUserRecord, schoolId: string, schoolYearId: string) {
  return user.status !== "inactive" && user.schoolId === schoolId && (!user.activeSchoolYearId || user.activeSchoolYearId === schoolYearId);
}

async function recipientsWithTokens(users: SchoolUserRecord[], repository: MessageRecipientRepository) {
  const recipients = await Promise.all(users.map(async (user) => {
    const tokens = await repository.listPushTokens(user.id);
    const seen = new Set<string>();
    return {
      userId: user.id,
      tokens: tokens.filter((token) => {
        if (!token.active || token.userId !== user.id || !token.token || seen.has(token.token)) return false;
        seen.add(token.token);
        return true;
      }),
    };
  }));
  return recipients.filter((recipient) => recipient.tokens.length > 0);
}

export async function resolveMessageRecipients(notification: MessageNotificationRecord, repository: MessageRecipientRepository): Promise<ResolvedMessageDispatch | null> {
  const message = await repository.getMessage(notification.messageId);
  if (
    !message || !message.threadId || !message.threadParentId || !message.schoolRecipient ||
    message.id !== notification.messageId || message.schoolId !== notification.schoolId || message.schoolYearId !== notification.schoolYearId
  ) return null;

  if (notification.recipientRole === "parent") {
    const parentId = notification.parentId;
    if (!parentId || message.recipientParentId !== parentId || message.threadParentId !== parentId) return null;
    const [parent, sender, users] = await Promise.all([
      repository.getParent(parentId),
      message.senderId ? repository.getUser(message.senderId) : Promise.resolve(null),
      repository.findParentUsers(parentId, notification.schoolId),
    ]);
    const allowedSenderRoles = ["school_admin", "cashier", "discipline_director"];
    if (!parent || parent.status === "inactive" || parent.schoolId !== notification.schoolId || parent.schoolYearId !== notification.schoolYearId) return null;
    if (!sender || !allowedSenderRoles.includes(sender.role ?? "") || !activeForYear(sender, notification.schoolId, notification.schoolYearId)) return null;
    const authorized = users.filter((user) => user.role === "parent" && user.parentId === parentId && activeForYear(user, notification.schoolId, notification.schoolYearId));
    return { event: "school_message_received", parentId, recipients: await recipientsWithTokens(authorized, repository) };
  }

  const schoolRecipient = notification.schoolRecipient;
  if (!schoolRecipient || message.recipientParentId !== "school" || message.schoolRecipient !== schoolRecipient) return null;
  const parentId = message.threadParentId;
  const [parent, sender, users] = await Promise.all([
    repository.getParent(parentId),
    message.senderId ? repository.getUser(message.senderId) : Promise.resolve(null),
    repository.findSchoolUsers(notification.schoolId, schoolRolesByRecipient[schoolRecipient]),
  ]);
  if (!parent || parent.status === "inactive" || parent.schoolId !== notification.schoolId || parent.schoolYearId !== notification.schoolYearId) return null;
  if (!sender || sender.role !== "parent" || sender.parentId !== parentId || !activeForYear(sender, notification.schoolId, notification.schoolYearId)) return null;
  const allowedRoles = schoolRolesByRecipient[schoolRecipient];
  const authorized = users.filter((user) => allowedRoles.includes(user.role ?? "") && user.role !== "super_admin" && activeForYear(user, notification.schoolId, notification.schoolYearId));
  return { event: "parent_message_received", parentId, schoolRecipient, recipients: await recipientsWithTokens(authorized, repository) };
}
