// Lot SA-2 : liste de recherche des écoles pour le Super administrateur.
// Une ligne courte par école, rangée dans SCHOOL_SEARCH_PARTS documents `schoolSearchIndex/part-XX`
// (champ `entries`, exempté d'index : aucun index combiné, presque aucun poids d'index).
// Une recherche lit ces quelques documents, puis filtre, trie et découpe en pages en mémoire.
// IMPORTANT : la même règle de simplification existe dans functions/src/platform/schoolSearchIndex.ts
// (déclencheur qui tient la liste à jour). Les deux sont vérifiées par les mêmes exemples de test.

export const SCHOOL_SEARCH_COLLECTION = "schoolSearchIndex";
export const SCHOOL_SEARCH_PARTS = 16;
export const SCHOOL_SEARCH_PAGE_SIZE = 25;
/** Écoles qui n'apparaissent pas dans la liste : supprimées ou en cours de suppression. */
const HIDDEN_STATUSES = new Set(["deleted", "deleting"]);

/** « C.S LUMBULA », « Lumbulá » → « c s lumbula » : minuscules, sans accents, sans ponctuation. */
export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Numéro de partie stable pour une école (FNV-1a sur l'identifiant). */
export function schoolSearchPart(schoolId) {
  let hash = 0x811c9dc5;
  for (const char of String(schoolId)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `part-${String(hash % SCHOOL_SEARCH_PARTS).padStart(2, "0")}`;
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Ligne de recherche d'une école ; null si elle ne doit pas apparaître. */
export function schoolSearchEntry(school) {
  if (!school || HIDDEN_STATUSES.has(String(school.status))) return null;
  const name = text(school.name, 160);
  const acronym = text(school.acronym, 40);
  const normalizedName = normalizeSearchText(name);
  const normalizedAcronym = normalizeSearchText(acronym);
  const fields = [normalizedName, normalizedAcronym, normalizeSearchText(text(school.address, 300)), normalizeSearchText(text(school.email, 160))];
  return {
    name,
    acronym,
    status: text(school.status, 20),
    schoolType: text(school.schoolType, 40),
    createdAt: text(school.createdAt, 40),
    logoVersion: text(school.logoVersion, 80),
    // Texte cherché : nom, sigle, adresse (ville, commune), e-mail ; plus le nom et le sigle sans espaces
    // (« cs lumbula » et « cslumbula » trouvent « C.S LUMBULA »).
    k: [...fields, normalizedName.replace(/ /g, ""), normalizedAcronym.replace(/ /g, "")].filter(Boolean).join(" | "),
    o: normalizedName,
  };
}

/** Vrai si une modification de l'école change sa ligne de recherche. */
export function schoolSearchEntryChanged(before, after) {
  return JSON.stringify(schoolSearchEntry(before)) !== JSON.stringify(schoolSearchEntry(after));
}

/** Mots de la recherche ; une recherche de moins de 2 caractères ne filtre pas. */
export function searchWords(query) {
  const normalized = normalizeSearchText(query);
  return normalized.replace(/ /g, "").length >= 2 ? normalized.split(" ").filter(Boolean) : [];
}

export function entryMatches(entry, words) {
  return words.every((word) => entry.k.includes(word));
}

const SORTS = {
  az: (a, b) => a.o.localeCompare(b.o, "fr") || a.id.localeCompare(b.id),
  recent: (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.o.localeCompare(b.o, "fr"),
  users: (a, b) => (b.u ?? 0) - (a.u ?? 0) || a.o.localeCompare(b.o, "fr"),
};

/** Filtre, trie et découpe en pages une liste de lignes { id, ...entry }. */
export function searchSchoolEntries(entries, { query = "", status = "all", schoolType = "all", sort = "az", page = 0, pageSize = SCHOOL_SEARCH_PAGE_SIZE } = {}) {
  const words = searchWords(query);
  const rows = entries
    .filter((entry) => status === "all" || entry.status === status)
    .filter((entry) => schoolType === "all" || entry.schoolType === schoolType)
    .filter((entry) => entryMatches(entry, words))
    .sort(SORTS[sort] ?? SORTS.az);
  const size = Math.min(100, Math.max(1, Number.isInteger(pageSize) ? pageSize : SCHOOL_SEARCH_PAGE_SIZE));
  const safePage = Math.max(0, Number.isInteger(page) ? page : 0);
  return {
    total: rows.length,
    page: safePage,
    pageSize: size,
    schools: rows.slice(safePage * size, safePage * size + size).map(({ id, name, acronym, status: rowStatus, schoolType: type, createdAt, logoVersion, u }) => ({
      id, name, acronym, status: rowStatus, schoolType: type, createdAt, logoVersion, users: u ?? null,
    })),
  };
}

/** Lit toutes les parties ; null si la liste n'a jamais été construite. */
export async function readSchoolSearchEntries(db) {
  const snapshot = await db.collection(SCHOOL_SEARCH_COLLECTION).get();
  if (snapshot.empty) return null;
  const entries = [];
  for (const doc of snapshot.docs) {
    for (const [id, entry] of Object.entries(doc.data()?.entries ?? {})) if (entry && typeof entry.k === "string") entries.push({ id, ...entry });
  }
  return entries;
}

let cache = null;
/** Lecture gardée 20 secondes dans le serveur (plusieurs frappes de recherche = une seule lecture). */
export async function cachedSchoolSearchEntries(db, { now = Date.now(), maxAgeMs = 20_000 } = {}) {
  if (cache && now - cache.at < maxAgeMs) return cache.entries;
  const entries = await readSchoolSearchEntries(db);
  cache = entries ? { at: now, entries } : null;
  return entries;
}
export function resetSchoolSearchCache() { cache = null; }
