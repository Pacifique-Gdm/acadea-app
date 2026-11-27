// Lot R6 (réglages par section) : qui est « Responsable des réglages » de quelle section.
// Lecture : comptes de l'école (document sectionSettingsManagers/{école}). Écriture : serveur seulement, à la demande de l'administrateur.
import { doc, onSnapshot } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import { apiErrorMessage } from "../utils/rateLimitErrors";
import type { ManagedSection, SectionSettingsManagers } from "../utils/sectionSettingsManagers";
import { MANAGED_SECTIONS } from "../utils/sectionSettingsManagers";

export function readSectionSettingsManagers(data: unknown, schoolId: string): SectionSettingsManagers {
  const record = data as { schoolId?: unknown; managers?: Record<string, { userId?: unknown; updatedAt?: unknown; updatedBy?: unknown }> } | undefined;
  if (!record || record.schoolId !== schoolId || !record.managers) return {};
  const result: SectionSettingsManagers = {};
  for (const section of MANAGED_SECTIONS) {
    const entry = record.managers[section];
    if (entry && typeof entry.userId === "string" && entry.userId) result[section] = { userId: entry.userId, ...(typeof entry.updatedAt === "string" ? { updatedAt: entry.updatedAt } : {}), ...(typeof entry.updatedBy === "string" ? { updatedBy: entry.updatedBy } : {}) };
  }
  return result;
}

export function subscribeToSectionSettingsManagers(input: { schoolId: string; onData: (managers: SectionSettingsManagers) => void; onError?: (error: Error) => void }) {
  if (!firebaseReady || !db || !input.schoolId) { input.onData({}); return () => undefined; }
  return onSnapshot(doc(db as unknown as Firestore, "sectionSettingsManagers", input.schoolId),
    (snapshot) => input.onData(snapshot.exists() ? readSectionSettingsManagers(snapshot.data(), input.schoolId) : {}),
    (error) => input.onError?.(error));
}

/** Coche (enabled) ou décoche la case. expectedUserId : responsable actuel vu à l'écran (remplacement confirmé). */
export async function setSectionSettingsManager(input: { schoolId: string; section: ManagedSection; userId: string; enabled: boolean; expectedUserId?: string | null }, fetcher: typeof fetch = fetch) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetcher(resolveApiUrl("/api/provision-school-account"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set-section-settings-manager", ...input, expectedUserId: input.expectedUserId ?? null }),
  });
  const payload = await response.json().catch(() => ({})) as { managers?: SectionSettingsManagers; error?: string; code?: string };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Désignation du responsable impossible."));
  return payload.managers ?? {};
}
