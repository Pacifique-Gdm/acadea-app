import { collection, doc, getCountFromServer, getDocs, limit, orderBy, query, startAfter, updateDoc, where, writeBatch } from "@firebase/firestore";
import type { DocumentSnapshot, Firestore, QueryConstraint } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppNotification, AppUser } from "../types";

export const NOTIFICATIONS_PAGE_SIZE = 30;

export type NotificationsPage = {
  items: AppNotification[];
  lastVisible: NotificationsCursor;
  hasMore: boolean;
};

export type NotificationsCursor = DocumentSnapshot | { school: DocumentSnapshot | null; personal: DocumentSnapshot | null } | null;

export function parentUnreadCount(legacyCount: number, personalCount: number, overlappingCount: number) {
  return Math.max(0, legacyCount + personalCount - overlappingCount);
}

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
  if (["secretary", "teacher", "study_director", "coordination_admin", "sub_coordination_admin"].includes(user.role)) return [...constraints, where("recipientUserId", "==", user.id)];
  if (user.role === "discipline_director") {
    return [...constraints, where("recipientRole", "==", "school"), where("schoolRecipient", "==", "discipline")];
  }
  return [...constraints, where("recipientRole", "==", "school")];
}

export async function loadNotificationsPage(
  user: AppUser,
  schoolId: string,
  schoolYearId: string,
  cursor?: NotificationsCursor,
): Promise<NotificationsPage> {
  const database = requireFirestore();
  if (user.role === "school_admin" || user.role === "cashier" || user.role === "parent") {
    const cursors = cursor && !("id" in cursor) ? cursor : { school: null, personal: null };
    const base = [where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)];
    const legacyRecipient = user.role === "parent" ? where("parentId", "==", user.parentId) : where("recipientRole", "==", "school");
    const [schoolPage, personalPage] = await Promise.all([
      getDocs(query(collection(database, "notifications"), ...base, legacyRecipient, orderBy("createdAt", "desc"), ...(cursors.school ? [startAfter(cursors.school)] : []), limit(NOTIFICATIONS_PAGE_SIZE))),
      getDocs(query(collection(database, "notifications"), ...base, where("recipientUserId", "==", user.id), orderBy("createdAt", "desc"), ...(cursors.personal ? [startAfter(cursors.personal)] : []), limit(NOTIFICATIONS_PAGE_SIZE))),
    ]);
    const selected = [...new Map([...schoolPage.docs, ...personalPage.docs].map((item) => [item.id, item])).values()]
      .sort((first, second) => String(second.data().createdAt ?? "").localeCompare(String(first.data().createdAt ?? "")) || second.id.localeCompare(first.id))
      .slice(0, NOTIFICATIONS_PAGE_SIZE);
    const selectedIds = new Set(selected.map((item) => item.id));
    const schoolConsumed = schoolPage.docs.filter((item) => selectedIds.has(item.id));
    const personalConsumed = personalPage.docs.filter((item) => selectedIds.has(item.id));
    const schoolCursor = schoolConsumed.at(-1) ?? cursors.school;
    const personalCursor = personalConsumed.at(-1) ?? cursors.personal;
    return {
      items: selected.map((item) => ({ id: item.id, ...item.data() })) as AppNotification[],
      lastVisible: { school: schoolCursor, personal: personalCursor },
      hasMore: schoolPage.docs.some((item) => !selectedIds.has(item.id)) || personalPage.docs.some((item) => !selectedIds.has(item.id))
        || schoolPage.docs.length === NOTIFICATIONS_PAGE_SIZE || personalPage.docs.length === NOTIFICATIONS_PAGE_SIZE,
    };
  }
  const constraints = [
    ...notificationRecipientConstraints(user, schoolId, schoolYearId),
    orderBy("createdAt", "desc"),
    ...(cursor && "id" in cursor ? [startAfter(cursor)] : []),
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
    const [legacySnapshot, personalSnapshot, overlappingSnapshot] = await Promise.all([
      getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("parentId", "==", user.parentId))),
      getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("recipientUserId", "==", user.id))),
      getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("parentId", "==", user.parentId), where("recipientUserId", "==", user.id))),
    ]);
    return parentUnreadCount(legacySnapshot.data().count, personalSnapshot.data().count, overlappingSnapshot.data().count);
  }
  if (["secretary", "teacher", "study_director", "coordination_admin", "sub_coordination_admin"].includes(user.role)) {
    const snapshot = await getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("recipientUserId", "==", user.id)));
    return snapshot.data().count;
  }

  const schoolRecipient = user.role === "cashier" ? "cashier" : user.role === "discipline_director" ? "discipline" : "admin";
  const visibleRecipients = user.role === "discipline_director" ? ["discipline"] : [schoolRecipient, "both"];
  const [visibleSnapshot, allSchoolSnapshot, adminSnapshot, cashierSnapshot, disciplineSnapshot, bothSnapshot, personalSnapshot] = await Promise.all([
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("recipientRole", "==", "school"), where("schoolRecipient", "in", visibleRecipients))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("recipientRole", "==", "school"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "==", "admin"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "==", "cashier"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "==", "discipline"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("schoolRecipient", "==", "both"))),
    getCountFromServer(query(collection(database, "notifications"), ...baseConstraints, where("recipientUserId", "==", user.id))),
  ]);
  const explicitSchoolUnread = adminSnapshot.data().count + cashierSnapshot.data().count + disciplineSnapshot.data().count + bothSnapshot.data().count;
  const legacySchoolUnread = Math.max(0, allSchoolSnapshot.data().count - explicitSchoolUnread);
  if (user.role === "discipline_director") return visibleSnapshot.data().count + personalSnapshot.data().count;
  return visibleSnapshot.data().count + legacySchoolUnread + personalSnapshot.data().count;
}

function canMarkSchoolNotificationRead(user: AppUser, notification: AppNotification) {
  if (["secretary", "teacher", "study_director", "coordination_admin", "sub_coordination_admin"].includes(user.role)) return notification.recipientUserId === user.id;
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
    const [legacySnapshot, personalSnapshot] = await Promise.all([
      getDocs(query(collection(database, "notifications"), ...baseConstraints, where("parentId", "==", user.parentId))),
      getDocs(query(collection(database, "notifications"), ...baseConstraints, where("recipientUserId", "==", user.id))),
    ]);
    const notificationIds = [...new Set([...legacySnapshot.docs, ...personalSnapshot.docs].map((item) => item.id))];
    await commitReadUpdates(database, notificationIds);
    return notificationIds.length;
  }

  if (["secretary", "teacher", "study_director", "coordination_admin", "sub_coordination_admin"].includes(user.role)) {
    const snapshot = await getDocs(query(collection(database, "notifications"), ...baseConstraints, where("recipientUserId", "==", user.id)));
    const notificationIds = snapshot.docs.map((item) => item.id);
    await commitReadUpdates(database, notificationIds);
    return notificationIds.length;
  }

  const notificationQuery =
    user.role === "discipline_director"
      ? query(collection(database, "notifications"), ...baseConstraints, where("recipientRole", "==", "school"), where("schoolRecipient", "==", "discipline"))
      : query(collection(database, "notifications"), ...baseConstraints, where("recipientRole", "==", "school"));
  const personalQuery = query(collection(database, "notifications"), ...baseConstraints, where("recipientUserId", "==", user.id));
  const [snapshot, personalSnapshot] = await Promise.all([getDocs(notificationQuery), getDocs(personalQuery)]);
  const notificationIds = [...new Set([
    ...snapshot.docs
      .filter((item) => canMarkSchoolNotificationRead(user, { id: item.id, ...item.data() } as AppNotification))
      .map((item) => item.id),
    ...personalSnapshot.docs.map((item) => item.id),
  ])];
  await commitReadUpdates(database, notificationIds);
  return notificationIds.length;
}
