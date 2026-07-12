import { collection, getDocs, limit, orderBy, query, startAfter, where } from "@firebase/firestore";
import type { DocumentSnapshot, Firestore, QueryConstraint } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, Conversation, Message } from "../types";

export const CONVERSATION_MESSAGES_PAGE_SIZE = 30;

export type ConversationMessagesPage = {
  items: Message[];
  lastVisible: DocumentSnapshot | null;
  hasMore: boolean;
};

function requireFirestore() {
  if (!firebaseReady || !db) {
    throw new Error("Firestore indisponible pour les messages.");
  }
  return db as unknown as Firestore;
}

function messageConversationConstraints(user: AppUser, conversation: Conversation): QueryConstraint[] {
  const constraints: QueryConstraint[] = [
    where("schoolId", "==", conversation.schoolId),
    where("schoolYearId", "==", conversation.schoolYearId),
    where("conversationId", "==", conversation.id),
  ];
  if (user.role === "parent") {
    return [...constraints, where("threadParentId", "==", user.parentId)];
  }
  return constraints;
}

export async function loadConversationMessagesPage(
  user: AppUser,
  conversation: Conversation,
  cursor?: DocumentSnapshot | null,
): Promise<ConversationMessagesPage> {
  const database = requireFirestore();
  const constraints = [
    ...messageConversationConstraints(user, conversation),
    orderBy("createdAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(CONVERSATION_MESSAGES_PAGE_SIZE),
  ];
  const snapshot = await getDocs(query(collection(database, "messages"), ...constraints));
  return {
    items: (snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Message[]).reverse(),
    lastVisible: snapshot.docs.at(-1) ?? null,
    hasMore: snapshot.docs.length === CONVERSATION_MESSAGES_PAGE_SIZE,
  };
}
