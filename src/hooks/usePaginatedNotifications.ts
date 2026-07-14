import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "@firebase/firestore";
import type { DocumentSnapshot, Firestore, Query } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import { countUnreadNotifications, loadNotificationsPage } from "../services/notificationsPagination";
import type { AppNotification, AppUser, Message } from "../types";

type UsePaginatedNotificationsOptions = {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  enabled: boolean;
  messages: Message[];
};

function mergeById(currentItems: AppNotification[], nextItems: AppNotification[]) {
  const itemsById = new Map<string, AppNotification>();
  [...currentItems, ...nextItems].forEach((item) => {
    itemsById.set(item.id, item);
  });
  return Array.from(itemsById.values()).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function baseNotificationQuery(database: Firestore) {
  return collection(database, "notifications");
}

function schoolNotificationValues(user: AppUser) {
  if (user.role === "cashier") return ["cashier", "both"];
  if (user.role === "discipline_director") return ["discipline"];
  return ["admin", "both"];
}

function realtimeNotificationQueries(
  database: Firestore,
  user: AppUser,
  schoolId: string,
  schoolYearId: string,
  options: { unreadOnly?: boolean; recentOnly?: boolean } = {},
): Query[] {
  const notificationCollection = baseNotificationQuery(database);
  const constraints = [
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
  ];
  const readConstraint = options.unreadOnly ? [where("read", "==", false)] : [];
  const recentConstraints = options.recentOnly ? [orderBy("createdAt", "desc"), limit(30)] : [];

  if (user.role === "parent") {
    if (!user.parentId) return [];
    return [
      query(
        notificationCollection,
        ...constraints,
        where("parentId", "==", user.parentId),
        ...readConstraint,
        ...recentConstraints,
      ),
    ];
  }

  const recipientValues = schoolNotificationValues(user);
  const explicitQuery = query(
    notificationCollection,
    ...constraints,
    where("recipientRole", "==", "school"),
    recipientValues.length === 1 ? where("schoolRecipient", "==", recipientValues[0]) : where("schoolRecipient", "in", recipientValues),
    ...readConstraint,
    ...recentConstraints,
  );

  if (user.role === "discipline_director") return [explicitQuery];

  const legacyQuery = query(
    notificationCollection,
    ...constraints,
    where("recipientRole", "==", "school"),
    ...readConstraint,
    ...recentConstraints,
  );
  return [explicitQuery, legacyQuery];
}

function mergeRealtimeNotifications(user: AppUser, messages: Message[], snapshots: AppNotification[][]) {
  const merged = mergeById([], snapshots.flat());
  if (user.role === "parent" || user.role === "discipline_director") return merged;
  return merged.filter((notification) => canShowSchoolNotification(user, notification, messages));
}

function canShowSchoolNotification(user: AppUser, notification: AppNotification, messages: Message[]) {
  if (notification.parentId || notification.recipientRole !== "school") return false;
  if (notification.schoolRecipient) {
    if (user.role === "school_admin") return notification.schoolRecipient === "admin" || notification.schoolRecipient === "both";
    if (user.role === "cashier") return notification.schoolRecipient === "cashier" || notification.schoolRecipient === "both";
    if (user.role === "discipline_director") return notification.schoolRecipient === "discipline";
  }
  if (!notification.messageId) return true;
  const linkedMessage = messages.find((message) => message.id === notification.messageId);
  if (!linkedMessage?.schoolRecipient) return true;
  if (user.role === "school_admin") return linkedMessage.schoolRecipient === "admin" || linkedMessage.schoolRecipient === "both";
  if (user.role === "cashier") return linkedMessage.schoolRecipient === "cashier" || linkedMessage.schoolRecipient === "both";
  if (user.role === "discipline_director") return linkedMessage.schoolRecipient === "discipline";
  return true;
}

export function usePaginatedNotifications({
  user,
  schoolId,
  schoolYearId,
  enabled,
  messages,
}: UsePaginatedNotificationsOptions) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  const visibleItems = useMemo(() => {
    if (user.role === "parent") return items;
    return items.filter((notification) => canShowSchoolNotification(user, notification, messages));
  }, [items, messages, user]);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const directUnreadCount = await countUnreadNotifications(user, schoolId, schoolYearId);
      setUnreadCount(directUnreadCount);
    } catch (error) {
      console.warn("Comptage des notifications non lues impossible.", error);
      setUnreadCount(0);
    }
  }, [schoolId, schoolYearId, user]);

  const loadFirstPage = useCallback(async () => {
    if (!enabled || !schoolId || !schoolYearId || isInitialLoading) return;
    setIsInitialLoading(true);
    setLoadError("");
    try {
      const page = await loadNotificationsPage(user, schoolId, schoolYearId);
      setItems(mergeById([], page.items));
      setCursor(page.lastVisible);
      setHasMore(page.hasMore);
      setHasLoaded(true);
    } catch (error) {
      console.warn("Chargement paginé des notifications impossible.", error);
      setLoadError("Impossible de charger les notifications. Veuillez réessayer.");
    } finally {
      setIsInitialLoading(false);
    }
  }, [enabled, isInitialLoading, schoolId, schoolYearId, user]);

  const loadMore = useCallback(async () => {
    if (!enabled || !schoolId || !schoolYearId || !hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadError("");
    try {
      const page = await loadNotificationsPage(user, schoolId, schoolYearId, cursor);
      setItems((current) => mergeById(current, page.items));
      setCursor(page.lastVisible);
      setHasMore(page.hasMore);
    } catch (error) {
      console.warn("Chargement des notifications suivantes impossible.", error);
      setLoadError("Impossible de charger la suite des notifications. Veuillez réessayer.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, enabled, hasMore, isLoadingMore, schoolId, schoolYearId, user]);

  const markAllRead = useCallback(() => {
    setItems((current) => current.map((notification) => ({ ...notification, read: true })));
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setHasLoaded(false);
    setLoadError("");
    setUnreadCount(null);
  }, [schoolId, schoolYearId, user.id, user.role, user.parentId]);

  useEffect(() => {
    if (user.role === "discipline_director") return;
    void refreshUnreadCount();
  }, [refreshUnreadCount, user.role]);

  useEffect(() => {
    if (!enabled || hasLoaded || isInitialLoading || loadError) return;
    void loadFirstPage();
  }, [enabled, hasLoaded, isInitialLoading, loadError, loadFirstPage]);

  useEffect(() => {
    if (!firebaseReady || !db || !schoolId || !schoolYearId) return undefined;
    const database = db as unknown as Firestore;
    const queries = realtimeNotificationQueries(database, user, schoolId, schoolYearId, { unreadOnly: true });
    const snapshots = new Array<AppNotification[]>(queries.length).fill([]);
    const unsubscribes = queries.map((notificationQuery, index) =>
      onSnapshot(
        notificationQuery,
        (snapshot) => {
          snapshots[index] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppNotification);
          setUnreadCount(mergeRealtimeNotifications(user, messages, snapshots).length);
        },
        (error) => {
          console.warn("Ecoute des notifications non lues impossible.", error);
        },
      ),
    );
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [messages, schoolId, schoolYearId, user]);

  useEffect(() => {
    if (!enabled || !firebaseReady || !db || !schoolId || !schoolYearId) return undefined;
    const database = db as unknown as Firestore;
    const queries = realtimeNotificationQueries(database, user, schoolId, schoolYearId, { recentOnly: true });
    const snapshots = new Array<AppNotification[]>(queries.length).fill([]);
    const unsubscribes = queries.map((notificationQuery, index) =>
      onSnapshot(
        notificationQuery,
        (snapshot) => {
          snapshots[index] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppNotification);
          setItems((current) => mergeById(current, mergeRealtimeNotifications(user, messages, snapshots)));
        },
        (error) => {
          console.warn("Ecoute des notifications recentes impossible.", error);
        },
      ),
    );
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled, messages, schoolId, schoolYearId, user]);

  return {
    items: visibleItems,
    unreadCount,
    isInitialLoading,
    isLoadingMore,
    loadError,
    hasMore,
    loadFirstPage,
    loadMore,
    markAllRead,
    refreshUnreadCount,
  };
}
