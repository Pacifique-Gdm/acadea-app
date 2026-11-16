import type { AppUser, Message } from "../types";

const COORDINATION_ROLES = new Set(["coordination_admin", "sub_coordination_admin"]);
const SCHOOL_STAFF = new Set(["school_admin", "admin", "secretary", "cashier", "discipline_director", "study_director", "teacher"]);
const PLATFORM_REPLIERS = new Set(["school_admin", "admin", "coordination_admin", "sub_coordination_admin"]);

/** Décisions du propriétaire (16/11) : le personnel de l'école répond à la Coordination et à la
 * Sous-coordination, jamais les parents ; administrateurs et coordinations répondent au Super administrateur. */
export function canReplyToMessage(message: Pick<Message, "senderId" | "senderRole" | "recipientIds">, user: Pick<AppUser, "id" | "role">) {
  if (message.senderId === user.id || !message.recipientIds?.includes(user.id)) return false;
  const senderRole = String(message.senderRole ?? "");
  if (COORDINATION_ROLES.has(senderRole)) return SCHOOL_STAFF.has(user.role);
  if (senderRole === "super_admin") return PLATFORM_REPLIERS.has(user.role);
  return false;
}
