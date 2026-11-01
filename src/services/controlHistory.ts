import { collection, getDocs, limit, orderBy, query, startAfter, where } from "@firebase/firestore";
import type { DocumentSnapshot, Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { CashInflow, Expense, Payment } from "../types";
import type { AppUser } from "../types";
import { isSectionAdministratorRole } from "../utils/sectionAdministratorYearScope";
import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";

export const CONTROL_HISTORY_PAGE_SIZE = 50;
export type ControlHistoryKind = "payments" | "expenses" | "cashInflows";
export type ControlHistoryItem = Payment | Expense | CashInflow;
export type ControlHistoryCursor = DocumentSnapshot | { id: string };

export type ControlHistoryPage<T extends ControlHistoryItem> = {
  items: T[];
  lastVisible: ControlHistoryCursor | null;
  hasMore: boolean;
};

export async function loadControlHistoryPage<T extends ControlHistoryItem>(
  kind: ControlHistoryKind,
  schoolId: string,
  schoolYearId: string,
  actor: Pick<AppUser, "role" | "schoolId">,
  cursor?: ControlHistoryCursor | null,
  yearBasis?: "collection",
): Promise<ControlHistoryPage<T>> {
  if (yearBasis && (kind !== "payments" || !isSectionAdministratorRole(actor.role))) {
    throw new Error("Filtre de collecte non autorisé.");
  }
  if (!schoolId || actor.schoolId !== schoolId) {
    throw new Error("Historique financier hors établissement.");
  }
  if (isSectionAdministratorRole(actor.role)) {
    const token = await getCurrentFirebaseIdToken();
    if (!token) throw new Error("Authentification requise.");
    const response = await fetch(resolveApiUrl("/api/manage-financial-transaction"), {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list-section-financial-history", kind, schoolYearId, ...(yearBasis ? { yearBasis } : {}), ...(cursor ? { cursorId: cursor.id } : {}) }),
    });
    const payload = await response.json().catch(() => ({})) as { items?: T[]; nextCursorId?: string | null; error?: string };
    if (!response.ok) throw new Error(payload.error || "Historique financier indisponible.");
    if (!Array.isArray(payload.items) || payload.items.some((item) => !item || item.schoolId !== schoolId
        || (yearBasis ? (item as Payment).collectionSchoolYearId : item.schoolYearId) !== schoolYearId)
      || payload.nextCursorId !== null && payload.nextCursorId !== undefined && typeof payload.nextCursorId !== "string") {
      throw new Error("Réponse de l'historique financier invalide.");
    }
    return { items: payload.items, lastVisible: payload.nextCursorId ? { id: payload.nextCursorId } : null,
      hasMore: Boolean(payload.nextCursorId) };
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
