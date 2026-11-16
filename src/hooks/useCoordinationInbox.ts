import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where, type Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import { markNotificationsReadTargeted } from "../services/notificationsPagination";
import type { AppNotification, AppUser, Message, School } from "../types";
import { activityTimestamp } from "../utils/activityHistory";

function mergeById<T extends { id: string; createdAt: string }>(groups: Map<string, T[]>) {
  return Array.from(new Map(Array.from(groups.values()).flat().map((item) => [item.id, item])).values())
    .sort((left, right) => activityTimestamp(right.createdAt) - activityTimestamp(left.createdAt));
}

export function useCoordinationInbox(user: AppUser, schools: School[], refreshToken = 0) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [platformNotifications, setPlatformNotifications] = useState<AppNotification[]>([]);
  const [platformMessages, setPlatformMessages] = useState<Message[]>([]);
  const scope = useMemo(
    () => schools.filter((school) => school.activeSchoolYearId).map((school) => ({ schoolId: school.id, schoolYearId: school.activeSchoolYearId })).sort((a, b) => a.schoolId.localeCompare(b.schoolId)),
    [schools],
  );
  const scopeKey = useMemo(() => scope.map((item) => `${item.schoolId}:${item.schoolYearId}`).join("|"), [scope]);

  useEffect(() => {
    setNotifications([]);
    setMessages([]);
    setError("");
    if (!firebaseReady || !db || !scopeKey) return undefined;
    const database = db as unknown as Firestore;
    const notificationsBySchool = new Map<string, AppNotification[]>();
    const messagesBySchool = new Map<string, Message[]>();
    const unsubscribes = scope.flatMap(({ schoolId, schoolYearId }) => {
      const notificationQuery = query(
        collection(database, "notifications"),
        where("schoolId", "==", schoolId),
        where("schoolYearId", "==", schoolYearId),
        where("recipientUserId", "==", user.id),
      );
      const messageQuery = query(
        collection(database, "messages"),
        where("schoolId", "==", schoolId),
        where("schoolYearId", "==", schoolYearId),
        where("participantIds", "array-contains", user.id),
        orderBy("createdAt", "desc"),
        limit(30),
      );
      return [
        onSnapshot(notificationQuery, (snapshot) => {
          notificationsBySchool.set(schoolId, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppNotification));
          setNotifications(mergeById(notificationsBySchool));
          setError("");
        }, () => setError("Impossible d'actualiser les notifications en temps réel.")),
        onSnapshot(messageQuery, (snapshot) => {
          messagesBySchool.set(schoolId, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Message));
          setMessages(mergeById(messagesBySchool));
          setError("");
        }, () => setError("Impossible d'actualiser les messages en temps réel.")),
      ];
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [refreshToken, scope, scopeKey, user.id]);

  // Lot 23 : messages du Super administrateur (sans école), écoutés en temps réel.
  useEffect(() => {
    setPlatformNotifications([]); setPlatformMessages([]);
    if (!firebaseReady || !db) return undefined;
    const database = db as unknown as Firestore;
    const unsubscribes = [
      onSnapshot(query(collection(database, "notifications"), where("recipientUserId", "==", user.id), where("platformMessage", "==", true), limit(50)),
        (snapshot) => setPlatformNotifications(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppNotification)), () => setError("Impossible d'actualiser les notifications en temps réel.")),
      onSnapshot(query(collection(database, "messages"), where("participantIds", "array-contains", user.id), where("platformMessage", "==", true), limit(50)),
        (snapshot) => setPlatformMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Message)), () => setError("Impossible d'actualiser les messages en temps réel.")),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [refreshToken, user.id]);

  const markAllRead = useCallback(async () => {
    const database = db as unknown as Firestore | undefined;
    if (database) await Promise.all(platformNotifications.filter((item) => !item.read).map((item) => updateDoc(doc(database, "notifications", item.id), { read: true })));
    const unreadScopes = new Map(notifications.filter((item) => !item.read && item.schoolId).map((item) => [`${item.schoolId}\u0000${item.schoolYearId}`, { schoolId: item.schoolId, schoolYearId: item.schoolYearId }]));
    await Promise.all(Array.from(unreadScopes.values()).map(({ schoolId, schoolYearId }) => markNotificationsReadTargeted(user, schoolId, schoolYearId)));
  }, [notifications, platformNotifications, user]);

  const allNotifications = useMemo(() => mergeById(new Map([["ecoles", notifications], ["plateforme", platformNotifications]])), [notifications, platformNotifications]);
  const allMessages = useMemo(() => mergeById(new Map([["ecoles", messages], ["plateforme", platformMessages]])), [messages, platformMessages]);
  return {
    notifications: allNotifications,
    messages: allMessages,
    unreadCount: allNotifications.filter((item) => !item.read).length,
    error,
    markAllRead,
  };
}

export { mergeById as mergeCoordinationInboxItems };
