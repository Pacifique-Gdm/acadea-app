import { collection, getCountFromServer, getDocs, limit, orderBy, query, startAfter, where } from "@firebase/firestore";
import type { DocumentSnapshot, Firestore, QueryConstraint } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppNotification, AppUser } from "../types";

export const NOTIFICATIONS_PAGE_SIZE = 30;

export type NotificationsPage = {
  items: AppNotification[];
  lastVisible: DocumentSnapshot | null;
  hasMore: boolean;
};

function requireFirestore() {
  if (!firebaseReady || !db) {
    throw new Error("Firestore indisponible pour les notifications.");
  }
  return db as unknown as Firestore;
}

function notificationRecipientConstraints(user: AppUser, schoolId: string, schoolYearId: string): QueryConstraint[] {
  const constraints: QueryConstraint[] = [
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
  ];
  if (user.role === "parent") {
    return [...constraints, where("parentId", "==", user.parentId)];
  }
  return [...constraints, where("recipientRole", "==", "school")];
}

export async function loadNotificationsPage(
  user: AppUser,
  schoolId: string,
  schoolYearId: string,
  cursor?: DocumentSnapshot | null,
): Promise<NotificationsPage> {
  const database = requireFirestore();
  const constraints = [
    ...notificationRecipientConstraints(user, schoolId, schoolYearId),
    orderBy("createdAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(NOTIFICATIONS_PAGE_SIZE),
  ];
  const snapshot = await getDocs(query(collection(database, "notifications"), ...constraints));
  return {
    items: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AppNotification[],
    lastVisible: snapshot.docs.at(-1) ?? null,
    hasMore: snapshot.docs.length === NOTIFICATIONS_PAGE_SIZE,
  };
}

export async function countUnreadNotifications(user: AppUser, schoolId: string, schoolYearId: string): Promise<number> {
  const database = requireFirestore();
  const baseConstraints = [
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
    where("read", "==", false),
  ];

  if (user.role === "parent") {
    const snapshot = await getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("parentId", "==", user.parentId)));
    return snapshot.data().count;
  }

  const schoolRecipient = user.role === "cashier" ? "cashier" : "admin";
  const snapshot = await getCountFromServer(
    query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "in", [schoolRecipient, "both"])),
  );
  return snapshot.data().count;
}
