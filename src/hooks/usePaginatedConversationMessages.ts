import { useCallback, useEffect, useState } from "react";
import type { DocumentSnapshot } from "@firebase/firestore";
import { loadConversationMessagesPage } from "../services/messagesPagination";
import type { AppUser, Conversation, Message } from "../types";

type UsePaginatedConversationMessagesOptions = {
  user: AppUser;
  conversation?: Conversation | null;
};

function mergeChronologicalMessages(currentItems: Message[], nextItems: Message[]) {
  const itemsById = new Map<string, Message>();
  [...currentItems, ...nextItems].forEach((item) => {
    itemsById.set(item.id, item);
  });
  return Array.from(itemsById.values()).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export function usePaginatedConversationMessages({ user, conversation }: UsePaginatedConversationMessagesOptions) {
  const [items, setItems] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [messagesError, setMessagesError] = useState("");

  const loadFirstPage = useCallback(async () => {
    if (!conversation || isLoadingMessages) return;
    setIsLoadingMessages(true);
    setMessagesError("");
    try {
      const page = await loadConversationMessagesPage(user, conversation);
      setItems(mergeChronologicalMessages([], page.items));
      setCursor(page.lastVisible);
      setHasOlderMessages(page.hasMore);
      setHasLoaded(true);
    } catch (error) {
      console.warn("Chargement paginé des messages impossible.", error);
      setMessagesError("Impossible de charger les messages. Veuillez réessayer.");
    } finally {
      setIsLoadingMessages(false);
    }
  }, [conversation, isLoadingMessages, user]);

  const loadOlder = useCallback(async () => {
    if (!conversation || !hasOlderMessages || isLoadingOlderMessages) return;
    setIsLoadingOlderMessages(true);
    setMessagesError("");
    try {
      const page = await loadConversationMessagesPage(user, conversation, cursor);
      setItems((current) => mergeChronologicalMessages(page.items, current));
      setCursor(page.lastVisible);
      setHasOlderMessages(page.hasMore);
    } catch (error) {
      console.warn("Chargement des messages précédents impossible.", error);
      setMessagesError("Impossible de charger les messages précédents. Veuillez réessayer.");
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [conversation, cursor, hasOlderMessages, isLoadingOlderMessages, user]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasOlderMessages(false);
    setHasLoaded(false);
    setMessagesError("");
  }, [conversation?.id]);

  useEffect(() => {
    if (!conversation || hasLoaded || isLoadingMessages || messagesError) return;
    void loadFirstPage();
  }, [conversation, hasLoaded, isLoadingMessages, loadFirstPage, messagesError]);

  return {
    items,
    isLoadingMessages,
    isLoadingOlderMessages,
    messagesError,
    hasOlderMessages,
    loadFirstPage,
    loadOlder,
  };
}
