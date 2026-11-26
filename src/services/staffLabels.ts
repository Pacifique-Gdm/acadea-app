// Lot R1 (réglages par section) : nom et fonction des auteurs des réglages, lus par le serveur.
// Mémoire de session : un même compte n'est demandé qu'une fois.
import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";

export type StaffLabel = { name: string; functionLabel: string };
const cache = new Map<string, StaffLabel | null>();
const cacheKey = (schoolId: string, uid: string) => `${schoolId}|${uid}`;

export function cachedStaffLabel(schoolId: string, uid: string) {
  return cache.get(cacheKey(schoolId, uid)) ?? undefined;
}

export function clearStaffLabelCache() {
  cache.clear();
}

export async function loadStaffLabels(schoolId: string, userIds: string[], fetcher: typeof fetch = fetch): Promise<Record<string, StaffLabel>> {
  const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id))];
  const missing = ids.filter((id) => !cache.has(cacheKey(schoolId, id))).slice(0, 50);
  if (missing.length) {
    const token = await getCurrentFirebaseIdToken();
    const response = await fetcher(resolveApiUrl("/api/manage-teacher-grading"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "staff-labels", schoolId, userIds: missing }),
    });
    const payload = await response.json().catch(() => ({})) as { labels?: Record<string, StaffLabel>; error?: string };
    if (!response.ok || !payload.labels) throw new Error(payload.error || "Auteur indisponible.");
    for (const id of missing) cache.set(cacheKey(schoolId, id), payload.labels[id] ?? null);
  }
  return Object.fromEntries(ids.map((id) => [id, cache.get(cacheKey(schoolId, id))]).filter((entry): entry is [string, StaffLabel] => Boolean(entry[1])));
}

/** Texte « Déjà modifié par [nom, fonction], rechargez. » ; l'auteur reste anonyme si son nom est indisponible. */
export async function alreadyModifiedMessage(schoolId: string, uid: string | undefined) {
  let who = "une autre personne";
  if (uid) {
    try {
      const label = (await loadStaffLabels(schoolId, [uid]))[uid];
      if (label) who = `${label.name}, ${label.functionLabel}`;
    } catch {
      // Le message reste utile sans le nom.
    }
  }
  return `Déjà modifié par ${who}, rechargez.`;
}
