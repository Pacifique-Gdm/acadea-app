import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

/** Lot SA-2 : liste de recherche des écoles du Super administrateur, tenue à jour par le serveur.
 * Même règle que api/_lib/schoolSearchIndex.js (mêmes exemples de test : schoolSearchIndex.vectors.json). */
export const SCHOOL_SEARCH_COLLECTION = "schoolSearchIndex";
export const SCHOOL_SEARCH_PARTS = 16;
const HIDDEN_STATUSES = new Set(["deleted", "deleting"]);
/** Comptes comptés pour le tri « Plus d'utilisateurs » (mêmes rôles que les statistiques d'école). */
const SCHOOL_USER_ROLES = ["school_admin", "parent", "cashier", "discipline_director", "secretary"];

type SchoolData = Record<string, unknown> | undefined;
export type SchoolSearchEntry = { name: string; acronym: string; status: string; schoolType: string; createdAt: string; logoVersion: string; k: string; o: string };

export function normalizeSearchText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function schoolSearchPart(schoolId: string) {
  let hash = 0x811c9dc5;
  for (const char of String(schoolId)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `part-${String(hash % SCHOOL_SEARCH_PARTS).padStart(2, "0")}`;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function schoolSearchEntry(school: SchoolData): SchoolSearchEntry | null {
  if (!school || HIDDEN_STATUSES.has(String(school.status))) return null;
  const name = text(school.name, 160);
  const acronym = text(school.acronym, 40);
  const normalizedName = normalizeSearchText(name);
  const normalizedAcronym = normalizeSearchText(acronym);
  const fields = [normalizedName, normalizedAcronym, normalizeSearchText(text(school.address, 300)), normalizeSearchText(text(school.email, 160))];
  return {
    name, acronym,
    status: text(school.status, 20),
    schoolType: text(school.schoolType, 40),
    createdAt: text(school.createdAt, 40),
    logoVersion: text(school.logoVersion, 80),
    k: [...fields, normalizedName.replace(/ /g, ""), normalizedAcronym.replace(/ /g, "")].filter(Boolean).join(" | "),
    o: normalizedName,
  };
}

/** Écriture à faire dans la partie de l'école ; null si la ligne ne change pas. */
export function schoolSearchUpdate(schoolId: string, before: SchoolData, after: SchoolData) {
  const previous = schoolSearchEntry(before);
  const next = schoolSearchEntry(after);
  if (JSON.stringify(previous) === JSON.stringify(next)) return null;
  return { part: schoolSearchPart(schoolId), entry: next };
}

/** Chaque création, modification ou suppression d'école, quel que soit l'écran : une écriture au plus. */
export const onSchoolSearchIndexChanged = onDocumentWritten({ document: "schools/{schoolId}", region: "europe-west1", maxInstances: 3, retry: true }, async (event) => {
  const schoolId = event.params.schoolId;
  const update = schoolSearchUpdate(schoolId, event.data?.before.data(), event.data?.after.data());
  if (!update) return;
  // Fusion : garde le nombre d'utilisateurs `u` déjà compté pour cette école.
  await getFirestore().doc(`${SCHOOL_SEARCH_COLLECTION}/${update.part}`).set({
    entries: { [schoolId]: update.entry ?? FieldValue.delete() },
    updatedAt: new Date().toISOString(),
  }, { merge: true });
});

/** Chaque nuit : nombre d'utilisateurs par école (1 comptage par école), pour le tri « Plus d'utilisateurs ». */
export const schoolSearchUserCounts = onSchedule({ schedule: "every day 02:30", timeZone: "Africa/Kinshasa", region: "europe-west1", timeoutSeconds: 1800, maxInstances: 1 }, async () => {
  const db = getFirestore();
  const parts = await db.collection(SCHOOL_SEARCH_COLLECTION).get();
  let schools = 0;
  for (const part of parts.docs) {
    const entries = Object.keys((part.data()?.entries ?? {}) as Record<string, unknown>);
    const counts: Record<string, { u: number }> = {};
    for (const schoolId of entries) {
      const snapshot = await db.collection("users").where("schoolId", "==", schoolId).where("role", "in", SCHOOL_USER_ROLES).count().get();
      counts[schoolId] = { u: snapshot.data().count };
      schools += 1;
    }
    if (entries.length) await part.ref.set({ entries: counts, usersCountedAt: new Date().toISOString() }, { merge: true });
  }
  logger.info("Utilisateurs comptés pour la liste de recherche des écoles.", { schools });
});
