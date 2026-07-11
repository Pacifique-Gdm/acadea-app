import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentSnapshot } from "@firebase/firestore";
import { countUnreadNotifications, loadNotificationsPage } from "../services/notificationsPagination";
import type { AppNotification, AppUser, Message } from "../types";

type UsePaginatedNotificationsOptions = {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  enabled: boolean;
  scopedNotifications: AppNotification[];
  messages: Message[];
};

function mergeById(currentItems: AppNotification[], nextItems: AppNotification[]) {
  const itemsById = new Map<string, AppNotification>();
  [...currentItems, ...nextItems].forEach((item) => {
    itemsById.set(item.id, item);
  });
  return Array.from(itemsById.values()).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function canShowSchoolNotification(user: AppUser, notification: AppNotification, messages: Message[]) {
  if (notification.parentId || notification.recipientRole !== "school") return false;
  if (notification.schoolRecipient) {
    if (user.role === "school_admin") return notification.schoolRecipient === "admin" || notification.schoolRecipient === "both";
    if (user.role === "cashier") return notification.schoolRecipient === "cashier" || notification.schoolRecipient === "both";
  }
  if (!notification.messageId) return true;
  const linkedMessage = messages.find((message) => message.id === notification.messageId);
  if (!linkedMessage?.schoolRecipient) return true;
  if (user.role === "school_admin") return linkedMessage.schoolRecipient === "admin" || linkedMessage.schoolRecipient === "both";
  if (user.role === "cashier") return linkedMessage.schoolRecipient === "cashier" || linkedMessage.schoolRecipient === "both";
  return true;
}

export function usePaginatedNotifications({
  user,
  schoolId,
  schoolYearId,
  enabled,
  scopedNotifications,
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
      const legacyUnreadCount =
        user.role === "parent"
          ? 0
          : scopedNotifications.filter((notification) => !notification.read && notification.recipientRole === "school" && !notification.schoolRecipient).length;
      setUnreadCount(directUnreadCount + legacyUnreadCount);
    } catch (error) {
      console.warn("Comptage des notifications non lues impossible.", error);
      setUnreadCount(scopedNotifications.filter((notification) => !notification.read).length);
    }
  }, [schoolId, schoolYearId, scopedNotifications, user]);

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
    void refreshUnreadCount();
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!enabled || hasLoaded || isInitialLoading || loadError) return;
    void loadFirstPage();
  }, [enabled, hasLoaded, isInitialLoading, loadError, loadFirstPage]);

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
