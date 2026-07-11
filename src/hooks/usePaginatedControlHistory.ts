import { useCallback, useEffect, useState } from "react";
import type { DocumentSnapshot } from "@firebase/firestore";
import { loadControlHistoryPage } from "../services/controlHistory";
import type { ControlHistoryItem, ControlHistoryKind } from "../services/controlHistory";

type UsePaginatedControlHistoryOptions = {
  kind: ControlHistoryKind;
  schoolId: string;
  schoolYearId: string;
  enabled: boolean;
};

function mergeById<T extends ControlHistoryItem>(currentItems: T[], nextItems: T[]) {
  const itemsById = new Map<string, T>();
  [...currentItems, ...nextItems].forEach((item) => {
    itemsById.set(item.id, item);
  });
  return Array.from(itemsById.values()).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export function usePaginatedControlHistory<T extends ControlHistoryItem>({
  kind,
  schoolId,
  schoolYearId,
  enabled,
}: UsePaginatedControlHistoryOptions) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadFirstPage = useCallback(async () => {
    if (!enabled || !schoolId || !schoolYearId || isInitialLoading) return;
    setIsInitialLoading(true);
    setLoadError("");
    try {
      const page = await loadControlHistoryPage<T>(kind, schoolId, schoolYearId);
      setItems(mergeById([], page.items));
      setCursor(page.lastVisible);
      setHasMore(page.hasMore);
      setHasLoaded(true);
    } catch (error) {
      console.warn("Chargement paginé de l'historique impossible.", error);
      setLoadError("Impossible de charger l'historique. Veuillez réessayer.");
    } finally {
      setIsInitialLoading(false);
    }
  }, [enabled, isInitialLoading, kind, schoolId, schoolYearId]);

  const loadMore = useCallback(async () => {
    if (!enabled || !schoolId || !schoolYearId || !hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadError("");
    try {
      const page = await loadControlHistoryPage<T>(kind, schoolId, schoolYearId, cursor);
      setItems((current) => mergeById(current, page.items));
      setCursor(page.lastVisible);
      setHasMore(page.hasMore);
    } catch (error) {
      console.warn("Chargement de la page suivante impossible.", error);
      setLoadError("Impossible de charger la suite de l'historique. Veuillez réessayer.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, enabled, hasMore, isLoadingMore, kind, schoolId, schoolYearId]);

  const prependItem = useCallback((item: T) => {
    setItems((current) => mergeById([item], current));
  }, []);

  const updateItem = useCallback((item: T) => {
    setItems((current) => mergeById(current.map((currentItem) => (currentItem.id === item.id ? item : currentItem)), []));
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setHasLoaded(false);
    setLoadError("");
  }, [kind, schoolId, schoolYearId]);

  useEffect(() => {
    if (enabled) return;
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setHasLoaded(false);
    setLoadError("");
  }, [enabled]);

  useEffect(() => {
    if (!enabled || hasLoaded || isInitialLoading || loadError) return;
    void loadFirstPage();
  }, [enabled, hasLoaded, isInitialLoading, loadError, loadFirstPage]);

  return {
    items,
    isInitialLoading,
    isLoadingMore,
    loadError,
    hasMore,
    loadFirstPage,
    loadMore,
    prependItem,
    updateItem,
    removeItem,
  };
}
