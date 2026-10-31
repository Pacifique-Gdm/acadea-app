import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { AppData } from "../types";
import { db } from "../firebase";
import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
export type SupportLine = {
  feeName: string;
  officialMinor: number;
  value: number;
  reductionMinor: number;
  commitmentMinor: number;
};
export type SupportDecision = {
  id: string;
  schoolId: string;
  schoolYearId: string;
  studentId: string;
  studentName: string;
  currency: "USD" | "CDF";
  matricule: string;
  className: string;
  reason: string;
  nature: string;
  personnelId: string | null;
  thirdPartyName: string;
  observation: string;
  lines: Record<string, SupportLine>;
  status: "active" | "cancelled" | "expired";
  version: number;
  validUntil: string;
  createdAt: string;
  updatedAt: string;
  history: SupportEvent[];
};
export type SupportEvent = {
  id: string;
  action: string;
  at: string;
  actorName: string;
  before: SupportDecision | null;
  after: SupportDecision;
};
export function subscribeSupport(
  schoolId: string,
  onData: (rows: SupportDecision[]) => void,
  onError: (e: Error) => void,
) {
  if (!db) {
    onError(new Error("Firebase indisponible."));
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "socialSupportDecisions"),
      where("schoolId", "==", schoolId),
    ),
    (snapshot) =>
      onData(
        snapshot.docs.map(
          (d) => ({ ...d.data(), id: d.id }) as SupportDecision,
        ),
      ),
    onError,
  );
}
export async function saveSupport(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(
    resolveApiUrl("/api/manage-financial-transaction"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Enregistrement impossible.");
  if (!result.decision?.id) throw new Error("Confirmation serveur incomplète.");
  return result.decision as SupportDecision;
}

/** Load complete tenant data for filtered exports, including archived decisions. */
export function subscribeSupportContext(
  schoolId: string,
  onData: (patch: Partial<AppData>) => void,
  onError: (e: Error) => void,
) {
  if (!db) {
    onError(new Error("Firebase indisponible."));
    return () => {};
  }
  const stops = ["students", "feeTypes", "payments"].map((name) =>
    onSnapshot(
      query(collection(db!, name), where("schoolId", "==", schoolId)),
      (snapshot) =>
        onData({
          [name]: snapshot.docs.map((d) => ({ ...d.data(), id: d.id })),
        } as Partial<AppData>),
      onError,
    ),
  );
  return () => stops.forEach((stop) => stop());
}

export async function reconcileSupport() {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(
    resolveApiUrl("/api/manage-financial-transaction"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "list-social-support" }),
    },
  );
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error ?? "Actualisation des décisions impossible.");
  }
}
