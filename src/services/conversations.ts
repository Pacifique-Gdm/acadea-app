import { collection, doc, getDocs, increment, query, runTransaction, where, writeBatch } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppNotification, AppUser, Conversation, Message } from "../types";
import { createConversationId } from "../utils/conversationIds";

type PersistConversationMessageInput = {
  user: AppUser;
  message: Message;
  notification: AppNotification;
  parentName?: string;
};

type PersistedConversationMessage = Message & { alreadyExisted?: boolean };

function createDisciplineSignalIdempotencyId(sanctionId: string) {
  return `disciplineSanction__${encodeURIComponent(sanctionId)}`;
}

function messageSenderRole(user: AppUser): Conversation["lastSenderRole"] {
  if (user.role === "parent" || user.role === "school_admin" || user.role === "cashier" || user.role === "discipline_director") return user.role;
  throw new Error("Rôle non autorisé pour la conversation.");
}

function conversationRecipient(message: Message) {
  return message.schoolRecipient ?? (message.recipientParentId === "school" ? "admin" : undefined);
}

export async function persistMessageWithConversation({
  user,
  message,
  notification,
  parentName,
}: PersistConversationMessageInput): Promise<PersistedConversationMessage> {
  if (!firebaseReady || !db) {
    throw new Error("Firestore indisponible pour la conversation.");
  }
  if (!message.threadId || !message.threadParentId) {
    throw new Error("Conversation impossible : threadId ou parent manquant.");
  }

  const senderRole = messageSenderRole(user);
  const threadId = message.threadId;
  const threadParentId = message.threadParentId;
  const conversationId = createConversationId(message.schoolId, message.schoolYearId, threadParentId, threadId);
  const messageWithConversation: Message = { ...message, conversationId };
  const database = db as unknown as Firestore;
  const conversationRef = doc(database, "conversations", conversationId);
  const messageRef = doc(database, "messages", message.id);
  const notificationRef = doc(database, "notifications", notification.id);
  const idempotencyRef = message.disciplineSanctionId
    ? doc(database, "messageIdempotency", message.schoolId, "signals", createDisciplineSignalIdempotencyId(message.disciplineSanctionId))
    : undefined;

  return runTransaction(database, async (transaction): Promise<PersistedConversationMessage> => {
    if (idempotencyRef) {
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (idempotencySnapshot.exists()) {
        return { ...messageWithConversation, alreadyExisted: true };
      }
    }

    const schoolRecipient = conversationRecipient(message);
    const nextConversation = {
      id: conversationId,
      schoolId: message.schoolId,
      schoolYearId: message.schoolYearId,
      threadId,
      threadParentId,
      parentId: threadParentId,
      parentName,
      schoolRecipient,
      lastMessage: message.body,
      lastMessageAt: message.createdAt,
      lastSenderId: message.senderId,
      lastSenderRole: senderRole,
      messageCount: increment(1),
      unreadParentCount: increment(senderRole === "parent" ? 0 : 1),
      unreadAdminCount: increment(senderRole === "parent" && (message.schoolRecipient === "admin" || message.schoolRecipient === "both") ? 1 : 0),
      unreadCashierCount: increment(senderRole === "parent" && (message.schoolRecipient === "cashier" || message.schoolRecipient === "both") ? 1 : 0),
      unreadDisciplineCount: increment(senderRole === "parent" && message.schoolRecipient === "discipline" ? 1 : 0),
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      status: "active",
    };

    transaction.set(conversationRef, nextConversation, { merge: true });
    transaction.set(messageRef, messageWithConversation);
    transaction.set(notificationRef, notification);
    if (idempotencyRef && message.disciplineSanctionId) {
      transaction.set(idempotencyRef, {
        schoolId: message.schoolId,
        schoolYearId: message.schoolYearId,
        sanctionId: message.disciplineSanctionId,
        messageId: message.id,
        notificationId: notification.id,
        createdAt: message.createdAt,
        type: "discipline-sanction-signal",
      });
    }
    return messageWithConversation;
  });

}

export async function markConversationUnreadCountRead(user: AppUser, schoolId: string, schoolYearId: string) {
  if (!firebaseReady || !db) return;

  const database = db as unknown as Firestore;
  const constraints = [
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
  ];
  const recipientConstraints =
    user.role === "parent"
      ? [...constraints, where("parentId", "==", user.parentId)]
      : user.role === "discipline_director"
        ? [
            ...constraints,
            where("schoolRecipient", "==", "discipline"),
          ]
      : [
          ...constraints,
          where("schoolRecipient", "in", [user.role === "cashier" ? "cashier" : "admin", "both"]),
        ];
  const snapshot = await getDocs(query(collection(database, "conversations"), ...recipientConstraints));
  if (snapshot.empty) return;

  const batch = writeBatch(database);
  snapshot.docs.forEach((conversationSnapshot) => {
    if (user.role === "parent") {
      batch.update(conversationSnapshot.ref, { unreadParentCount: 0 });
      return;
    }
    if (user.role === "cashier") {
      batch.update(conversationSnapshot.ref, { unreadCashierCount: 0 });
      return;
    }
    if (user.role === "discipline_director") {
      batch.update(conversationSnapshot.ref, { unreadDisciplineCount: 0 });
      return;
    }
    batch.update(conversationSnapshot.ref, { unreadAdminCount: 0 });
  });
  await batch.commit();
}

export async function markSingleConversationUnreadCountRead(user: AppUser, conversationId: string) {
  if (!firebaseReady || !db) return;

  const database = db as unknown as Firestore;
  const conversationRef = doc(database, "conversations", conversationId);
  const batch = writeBatch(database);
  if (user.role === "parent") {
    batch.update(conversationRef, { unreadParentCount: 0 });
  } else if (user.role === "cashier") {
    batch.update(conversationRef, { unreadCashierCount: 0 });
  } else if (user.role === "discipline_director") {
    batch.update(conversationRef, { unreadDisciplineCount: 0 });
  } else {
    batch.update(conversationRef, { unreadAdminCount: 0 });
  }
  await batch.commit();
}
