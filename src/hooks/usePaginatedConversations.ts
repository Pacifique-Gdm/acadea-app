import { useCallback, useEffect, useState } from "react";
import type { DocumentSnapshot } from "@firebase/firestore";
import { loadConversationsPage } from "../services/conversationsPagination";
import type { AppUser, Conversation } from "../types";

type UsePaginatedConversationsOptions = {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  enabled: boolean;
};

function mergeConversations(currentItems: Conversation[], nextItems: Conversation[]) {
  const itemsById = new Map<string, Conversation>();
  [...currentItems, ...nextItems].forEach((item) => {
    itemsById.set(item.id, item);
  });
  return Array.from(itemsById.values()).sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
}

export function usePaginatedConversations({ user, schoolId, schoolYearId, enabled }: UsePaginatedConversationsOptions) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [conversationError, setConversationError] = useState("");

  const loadFirstPage = useCallback(async () => {
    if (!enabled || !schoolId || !schoolYearId || isLoadingConversations) return;
    setIsLoadingConversations(true);
    setConversationError("");
    try {
      const page = await loadConversationsPage(user, schoolId, schoolYearId);
      setItems(mergeConversations([], page.items));
      setCursor(page.lastVisible);
      setHasMore(page.hasMore);
      setHasLoaded(true);
    } catch (error) {
      console.warn("Chargement paginé des conversations impossible.", error);
      setConversationError("Impossible de charger les conversations. Veuillez réessayer.");
    } finally {
      setIsLoadingConversations(false);
    }
  }, [enabled, isLoadingConversations, schoolId, schoolYearId, user]);

  const loadMore = useCallback(async () => {
    if (!enabled || !schoolId || !schoolYearId || !hasMore || isLoadingMoreConversations) return;
    setIsLoadingMoreConversations(true);
    setConversationError("");
    try {
      const page = await loadConversationsPage(user, schoolId, schoolYearId, cursor);
      setItems((current) => mergeConversations(current, page.items));
      setCursor(page.lastVisible);
      setHasMore(page.hasMore);
    } catch (error) {
      console.warn("Chargement des conversations suivantes impossible.", error);
      setConversationError("Impossible de charger la suite des conversations. Veuillez réessayer.");
    } finally {
      setIsLoadingMoreConversations(false);
    }
  }, [cursor, enabled, hasMore, isLoadingMoreConversations, schoolId, schoolYearId, user]);

  const markConversationRead = useCallback((conversationId: string, role: AppUser["role"]) => {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== conversationId) return item;
        if (role === "parent") return { ...item, unreadParentCount: 0 };
        if (role === "cashier") return { ...item, unreadCashierCount: 0 };
        return { ...item, unreadAdminCount: 0 };
      }),
    );
  }, []);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setHasLoaded(false);
    setConversationError("");
  }, [schoolId, schoolYearId, user.id, user.role, user.parentId]);

  useEffect(() => {
    if (!enabled || hasLoaded || isLoadingConversations || conversationError) return;
    void loadFirstPage();
  }, [conversationError, enabled, hasLoaded, isLoadingConversations, loadFirstPage]);

  return {
    items,
    isLoadingConversations,
    isLoadingMoreConversations,
    conversationError,
    hasMoreConversations: hasMore,
    loadFirstPage,
    loadMore,
    markConversationRead,
  };
}
