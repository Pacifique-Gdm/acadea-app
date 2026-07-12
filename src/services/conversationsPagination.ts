import { collection, getDocs, limit, orderBy, query, startAfter, where } from "@firebase/firestore";
import type { DocumentSnapshot, Firestore, QueryConstraint } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, Conversation } from "../types";

export const CONVERSATIONS_PAGE_SIZE = 30;

export type ConversationsPage = {
  items: Conversation[];
  lastVisible: DocumentSnapshot | null;
  hasMore: boolean;
};

function requireFirestore() {
  if (!firebaseReady || !db) {
    throw new Error("Firestore indisponible pour les conversations.");
  }
  return db as unknown as Firestore;
}

function conversationRecipientConstraints(user: AppUser, schoolId: string, schoolYearId: string): QueryConstraint[] {
  const constraints: QueryConstraint[] = [
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
  ];
  if (user.role === "parent") {
    return [...constraints, where("parentId", "==", user.parentId)];
  }
  return [...constraints, where("schoolRecipient", "in", [user.role === "cashier" ? "cashier" : "admin", "both"])];
}

export async function loadConversationsPage(
  user: AppUser,
  schoolId: string,
  schoolYearId: string,
  cursor?: DocumentSnapshot | null,
): Promise<ConversationsPage> {
  const database = requireFirestore();
  const constraints = [
    ...conversationRecipientConstraints(user, schoolId, schoolYearId),
    orderBy("lastMessageAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(CONVERSATIONS_PAGE_SIZE),
  ];
  const snapshot = await getDocs(query(collection(database, "conversations"), ...constraints));
  return {
    items: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Conversation[],
    lastVisible: snapshot.docs.at(-1) ?? null,
    hasMore: snapshot.docs.length === CONVERSATIONS_PAGE_SIZE,
  };
}
