import { collection, getDocs, limit, orderBy, query, startAfter, where } from "@firebase/firestore";
import type { DocumentSnapshot, Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { Expense, Payment } from "../types";

export const CONTROL_HISTORY_PAGE_SIZE = 50;
export type ControlHistoryKind = "payments" | "expenses";
export type ControlHistoryItem = Payment | Expense;

export type ControlHistoryPage<T extends ControlHistoryItem> = {
  items: T[];
  lastVisible: DocumentSnapshot | null;
  hasMore: boolean;
};

export async function loadControlHistoryPage<T extends ControlHistoryItem>(
  kind: ControlHistoryKind,
  schoolId: string,
  schoolYearId: string,
  cursor?: DocumentSnapshot | null,
): Promise<ControlHistoryPage<T>> {
  if (!firebaseReady || !db) {
    throw new Error("Firestore indisponible pour l'historique.");
  }

  const database = db as unknown as Firestore;
  const constraints = [
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
    orderBy("createdAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(CONTROL_HISTORY_PAGE_SIZE),
  ];
  const snapshot = await getDocs(query(collection(database, kind), ...constraints));
  const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as T[];
  return {
    items,
    lastVisible: snapshot.docs.at(-1) ?? null,
    hasMore: snapshot.docs.length === CONTROL_HISTORY_PAGE_SIZE,
  };
}
