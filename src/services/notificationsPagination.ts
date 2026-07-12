import { collection, doc, getCountFromServer, getDocs, limit, orderBy, query, startAfter, updateDoc, where, writeBatch } from "@firebase/firestore";
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
  if (user.role === "discipline_director") {
    return [...constraints, where("recipientRole", "==", "school"), where("schoolRecipient", "==", "discipline")];
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

  const schoolRecipient = user.role === "cashier" ? "cashier" : user.role === "discipline_director" ? "discipline" : "admin";
  const visibleRecipients = user.role === "discipline_director" ? ["discipline"] : [schoolRecipient, "both"];
  const [visibleSnapshot, allSchoolSnapshot, adminSnapshot, cashierSnapshot, disciplineSnapshot, bothSnapshot] = await Promise.all([
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("recipientRole", "==", "school"), where("schoolRecipient", "in", visibleRecipients))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("recipientRole", "==", "school"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "==", "admin"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "==", "cashier"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "==", "discipline"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "==", "both"))),
  ]);
  const explicitSchoolUnread = adminSnapshot.data().count + cashierSnapshot.data().count + disciplineSnapshot.data().count + bothSnapshot.data().count;
  const legacySchoolUnread = Math.max(0, allSchoolSnapshot.data().count - explicitSchoolUnread);
  if (user.role === "discipline_director") return visibleSnapshot.data().count;
  return visibleSnapshot.data().count + legacySchoolUnread;
}

function canMarkSchoolNotificationRead(user: AppUser, notification: AppNotification) {
  if (notification.parentId || notification.recipientRole !== "school") return false;
  if (!notification.schoolRecipient) return true;
  if (user.role === "school_admin") return notification.schoolRecipient === "admin" || notification.schoolRecipient === "both";
  if (user.role === "cashier") return notification.schoolRecipient === "cashier" || notification.schoolRecipient === "both";
  if (user.role === "discipline_director") return notification.schoolRecipient === "discipline";
  return false;
}

async function commitReadUpdates(database: Firestore, notificationIds: string[]) {
  for (let index = 0; index < notificationIds.length; index += 450) {
    const batch = writeBatch(database);
    notificationIds.slice(index, index + 450).forEach((notificationId) => {
      batch.update(doc(database, "notifications", notificationId), { read: true });
    });
    await batch.commit();
  }
}

export async function markNotificationsReadTargeted(user: AppUser, schoolId: string, schoolYearId: string, notificationId?: string) {
  const database = requireFirestore();
  if (notificationId) {
    await updateDoc(doc(database, "notifications", notificationId), { read: true });
    return 1;
  }

  const baseConstraints = [
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
    where("read", "==", false),
  ];

  if (user.role === "parent") {
    const snapshot = await getDocs(query(collection(database, "notifications"), ...baseConstraints, where("parentId", "==", user.parentId)));
    const notificationIds = snapshot.docs.map((item) => item.id);
    await commitReadUpdates(database, notificationIds);
    return notificationIds.length;
  }

  const notificationQuery =
    user.role === "discipline_director"
      ? query(collection(database, "notifications"), ...baseConstraints, where("recipientRole", "==", "school"), where("schoolRecipient", "==", "discipline"))
      : query(collection(database, "notifications"), ...baseConstraints, where("recipientRole", "==", "school"));
  const snapshot = await getDocs(notificationQuery);
  const notificationIds = snapshot.docs
    .filter((item) => canMarkSchoolNotificationRead(user, { id: item.id, ...item.data() } as AppNotification))
    .map((item) => item.id);
  await commitReadUpdates(database, notificationIds);
  return notificationIds.length;
}
