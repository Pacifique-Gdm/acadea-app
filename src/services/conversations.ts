import { collection, doc, getDocs, query, runTransaction, where, writeBatch } from "@firebase/firestore";
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

function messageSenderRole(user: AppUser): Conversation["lastSenderRole"] {
  if (user.role === "parent" || user.role === "school_admin" || user.role === "cashier") return user.role;
  throw new Error("Rôle non autorisé pour la conversation.");
}

function conversationRecipient(message: Message) {
  if (message.recipientParentId === "school") return message.schoolRecipient ?? "admin";
  return undefined;
}

export async function persistMessageWithConversation({
  user,
  message,
  notification,
  parentName,
}: PersistConversationMessageInput) {
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

  await runTransaction(database, async (transaction) => {
    const conversationSnapshot = await transaction.get(conversationRef);
    const existingConversation = conversationSnapshot.exists() ? (conversationSnapshot.data() as Conversation) : undefined;
    const schoolRecipient = existingConversation?.schoolRecipient ?? conversationRecipient(message);
    const createdAt = existingConversation?.createdAt ?? message.createdAt;
    const shouldUpdateLastMessage = !existingConversation || message.createdAt >= existingConversation.lastMessageAt;
    const baseConversation: Conversation = existingConversation ?? {
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
      messageCount: 0,
      unreadParentCount: 0,
      unreadAdminCount: 0,
      unreadCashierCount: 0,
      createdAt,
      updatedAt: message.createdAt,
      status: "active",
    };
    const nextConversation: Conversation = {
      ...baseConversation,
      parentName: parentName ?? baseConversation.parentName,
      schoolRecipient,
      messageCount: (existingConversation?.messageCount ?? 0) + 1,
      unreadParentCount: baseConversation.unreadParentCount + (senderRole === "parent" ? 0 : 1),
      unreadAdminCount:
        baseConversation.unreadAdminCount +
        (senderRole === "parent" && (message.schoolRecipient === "admin" || message.schoolRecipient === "both") ? 1 : 0),
      unreadCashierCount:
        baseConversation.unreadCashierCount +
        (senderRole === "parent" && (message.schoolRecipient === "cashier" || message.schoolRecipient === "both") ? 1 : 0),
      updatedAt: message.createdAt,
    };

    if (shouldUpdateLastMessage) {
      nextConversation.lastMessage = message.body;
      nextConversation.lastMessageAt = message.createdAt;
      nextConversation.lastSenderId = message.senderId;
      nextConversation.lastSenderRole = senderRole;
    }

    transaction.set(conversationRef, nextConversation);
    transaction.set(messageRef, messageWithConversation);
    transaction.set(notificationRef, notification);
  });

  return messageWithConversation;
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
    batch.update(conversationSnapshot.ref, { unreadAdminCount: 0 });
  });
  await batch.commit();
}
