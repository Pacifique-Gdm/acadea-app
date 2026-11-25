// Lot 3 : enfants à la charge du membre du personnel connecté, lus par le serveur (aucune lecture directe des paiements).
import type { FeeType, Payment, Student } from "../types";
import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";

export type StaffChildDecision = {
  id: string;
  reason: string;
  nature: "full" | "percent" | "fixed" | string;
  lines: Record<string, { feeName?: string; value?: number; officialMinor?: number; reductionMinor?: number }>;
};
export type StaffChild = { student: Student; decision: StaffChildDecision; payments: Payment[] };
export type StaffChildrenResult = { children: StaffChild[]; feeTypes: FeeType[]; currency: "USD" | "CDF"; schoolYearId?: string };

export async function loadStaffChildren(): Promise<StaffChildrenResult> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-financial-transaction"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list-staff-children" }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Chargement de vos enfants impossible.");
  return {
    children: Array.isArray(result.children) ? result.children : [],
    feeTypes: Array.isArray(result.feeTypes) ? result.feeTypes : [],
    currency: result.currency === "CDF" ? "CDF" : "USD",
    schoolYearId: typeof result.schoolYearId === "string" ? result.schoolYearId : undefined,
  };
}

/** Signal de vrai changement : identifiants des notifications « Paiement enregistré » adressées à ce membre
 * du personnel (lot 4), déjà reçues en direct par l'application. Un nouvel identifiant = un nouveau paiement. */
export function staffPaymentNotificationIds(notifications: ReadonlyArray<{ id: string; recipientUserId?: string; type?: string; event?: string }> | undefined, userId: string): string[] {
  return (notifications ?? []).filter((item) => item.recipientUserId === userId && item.type === "payment" && item.event === "payment_recorded").map((item) => item.id).sort();
}

// Point de partage du signal : l'application publie la liste, l'écran « Enfants » la lit (aucune lecture Firestore).
// Les identifiants s'ajoutent seulement (deux sources : liste des notifications et écoute des non lues) :
// une notification lue qui sort d'une liste ne relance rien ; seul un identifiant jamais vu prévient l'écran.
const knownPaymentIds = new Set<string>();
let publishedPaymentIds = "";
const paymentIdListeners = new Set<() => void>();
export function publishStaffPaymentNotificationIds(ids: string[]) {
  const before = knownPaymentIds.size;
  ids.forEach((id) => knownPaymentIds.add(id));
  if (knownPaymentIds.size === before) return;
  publishedPaymentIds = [...knownPaymentIds].sort().join("|");
  paymentIdListeners.forEach((listener) => listener());
}
export const subscribeStaffPaymentNotificationIds = (listener: () => void) => { paymentIdListeners.add(listener); return () => { paymentIdListeners.delete(listener); }; };
export const readStaffPaymentNotificationIds = () => publishedPaymentIds;
/** Vrai changement : une notification « Paiement enregistré » que la réponse gardée n'avait pas encore vue. */
export function hasNewStaffPayment(seenPaymentIds: readonly string[], signal: string) {
  return Boolean(signal) && signal.split("|").some((id) => !seenPaymentIds.includes(id));
}

/** Ce que l'enfant paie selon la décision de l'administrateur : rien, la moitié, ou une réduction. */
export function staffChildSupportLabel(decision: Pick<StaffChildDecision, "nature" | "lines">): string {
  if (decision.nature === "full") return "Prise en charge : rien à payer";
  const values = Object.values(decision.lines ?? {}).map((line) => line.value);
  if (decision.nature === "percent" && values.length > 0 && values.every((value) => value === 50)) return "Prise en charge : la moitié";
  if (decision.nature === "percent" && values.length > 0 && values.every((value) => value === 100)) return "Prise en charge : rien à payer";
  return "Prise en charge : réduction accordée";
}
