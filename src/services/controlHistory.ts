import { collection, getDocs, limit, orderBy, query, startAfter, where } from "@firebase/firestore";
import type { DocumentSnapshot, Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { CashInflow, Expense, Payment } from "../types";
import type { AppUser } from "../types";
import { isSectionAdministratorRole } from "../utils/sectionAdministratorYearScope";

export const CONTROL_HISTORY_PAGE_SIZE = 50;
export type ControlHistoryKind = "payments" | "expenses" | "cashInflows";
export type ControlHistoryItem = Payment | Expense | CashInflow;

export type ControlHistoryPage<T extends ControlHistoryItem> = {
  items: T[];
  lastVisible: DocumentSnapshot | null;
  hasMore: boolean;
};

export async function loadControlHistoryPage<T extends ControlHistoryItem>(
  kind: ControlHistoryKind,
  schoolId: string,
  schoolYearId: string,
  actor: Pick<AppUser, "role" | "schoolId">,
  cursor?: DocumentSnapshot | null,
): Promise<ControlHistoryPage<T>> {
  // The existing pagination query reads the entire school's financial ledger.
  // A section administrator needs a server-resolved, linked-entity history;
  // filtering the result in the browser would disclose other sections.
  if (isSectionAdministratorRole(actor.role)) {
    throw new Error("Historique financier indisponible : périmètre de section non sécurisé.");
  }
  if (!schoolId || actor.schoolId !== schoolId) {
    throw new Error("Historique financier hors établissement.");
  }
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
