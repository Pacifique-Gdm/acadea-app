import type { School } from "../types";

/**
 * Logo de l'école rangé à part.
 *
 * Le logo (image complète, environ 60 Ko) n'est plus stocké dans le document
 * `schools/{id}`, relu par de nombreux écrans. Il est rangé dans
 * `schoolLogos/{id}` ; l'école ne garde que `logoVersion`, un petit repère qui
 * change à chaque nouveau logo. Les écrans qui affichent le logo le lisent
 * seulement à ce moment-là, puis il reste gardé en mémoire (et sur l'appareil)
 * tant que la version ne change pas.
 *
 * Compatibilité : une école qui porte encore l'ancien champ `logoUrl` (avant la
 * migration, ou modifiée par une ancienne version de l'application) l'affiche
 * directement, sans aucune lecture supplémentaire.
 */
export const SCHOOL_LOGO_COLLECTION = "schoolLogos";

export type SchoolLogoSource = Pick<School, "id"> & Partial<Pick<School, "logoUrl" | "logoVersion">>;
export type SchoolLogoRecord = { logoUrl?: string; logoVersion?: string } | null | undefined;
export type SchoolLogoLoader = (schoolId: string) => Promise<SchoolLogoRecord>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_PREFIX = "acadea.schoolLogo.";
const memory = new Map<string, { version: string; promise: Promise<string>; value?: string }>();
let loader: SchoolLogoLoader = defaultLoader;
let storageOverride: StorageLike | null | undefined;

async function defaultLoader(schoolId: string): Promise<SchoolLogoRecord> {
  const [{ db }, { doc, getDoc }] = await Promise.all([import("../firebase"), import("firebase/firestore")]);
  if (!db) return null;
  const snapshot = await getDoc(doc(db, SCHOOL_LOGO_COLLECTION, schoolId));
  return snapshot.exists() ? snapshot.data() as SchoolLogoRecord : null;
}

function storage(): StorageLike | null {
  if (storageOverride !== undefined) return storageOverride;
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; }
  catch { return null; }
}

function readStored(schoolId: string, version: string): string | undefined {
  try {
    const raw = storage()?.getItem(STORAGE_PREFIX + schoolId);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { version?: unknown; logoUrl?: unknown };
    return parsed.version === version && typeof parsed.logoUrl === "string" ? parsed.logoUrl : undefined;
  } catch { return undefined; }
}

function writeStored(schoolId: string, version: string, logoUrl: string) {
  try {
    const target = storage();
    if (!target) return;
    if (!logoUrl) target.removeItem(STORAGE_PREFIX + schoolId);
    else target.setItem(STORAGE_PREFIX + schoolId, JSON.stringify({ version, logoUrl }));
  } catch { /* stockage plein ou bloqué : la mémoire suffit */ }
}

function legacyLogo(school: SchoolLogoSource) {
  return typeof school.logoUrl === "string" ? school.logoUrl.trim() : "";
}

function logoVersionOf(school: SchoolLogoSource) {
  return typeof school.logoVersion === "string" ? school.logoVersion.trim() : "";
}

/** Vrai si l'école a un logo (ancien champ ou logo rangé à part). */
export function schoolHasLogo(school: SchoolLogoSource | null | undefined) {
  return Boolean(school && (legacyLogo(school) || logoVersionOf(school)));
}

/** Logo déjà connu, sans aucune lecture : ancien champ, mémoire ou appareil. */
export function peekSchoolLogo(school: SchoolLogoSource | null | undefined): string | undefined {
  if (!school) return "";
  const legacy = legacyLogo(school);
  if (legacy) return legacy;
  const version = logoVersionOf(school);
  if (!version) return "";
  const cached = memory.get(school.id);
  if (cached?.version === version && cached.value !== undefined) return cached.value;
  const stored = readStored(school.id, version);
  if (stored !== undefined) {
    memory.set(school.id, { version, promise: Promise.resolve(stored), value: stored });
    return stored;
  }
  return undefined;
}

/** Logo de l'école ("" s'il n'y en a pas). Une seule lecture par version. */
export function loadSchoolLogo(school: SchoolLogoSource | null | undefined): Promise<string> {
  const known = peekSchoolLogo(school);
  if (known !== undefined) return Promise.resolve(known);
  const source = school as SchoolLogoSource;
  const version = logoVersionOf(source);
  const cached = memory.get(source.id);
  if (cached?.version === version) return cached.promise;
  const entry: { version: string; promise: Promise<string>; value?: string } = { version, promise: Promise.resolve("") };
  entry.promise = loader(source.id)
    .then((record) => {
      const logoUrl = typeof record?.logoUrl === "string" ? record.logoUrl : "";
      entry.value = logoUrl;
      writeStored(source.id, version, logoUrl);
      return logoUrl;
    })
    .catch((error) => {
      // Lecture impossible (hors ligne…) : on réessaiera au prochain affichage.
      if (memory.get(source.id) === entry) memory.delete(source.id);
      console.warn("Logo de l'école indisponible.", error);
      return "";
    });
  memory.set(source.id, entry);
  return entry.promise;
}

/** Après un enregistrement : le nouveau logo est connu sans relecture. */
export function primeSchoolLogo(schoolId: string, version: string, logoUrl: string) {
  if (!schoolId || !version) return;
  memory.set(schoolId, { version, promise: Promise.resolve(logoUrl), value: logoUrl });
  writeStored(schoolId, version, logoUrl);
}

/** Repère de version d'un logo : empreinte courte de son contenu. */
export async function computeSchoolLogoVersion(logoUrl: string): Promise<string> {
  if (!logoUrl) return "";
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(logoUrl));
    return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Réservé aux tests. */
export function resetSchoolLogoCacheForTests(options: { loader?: SchoolLogoLoader; storage?: StorageLike | null } = {}) {
  memory.clear();
  loader = options.loader ?? defaultLoader;
  storageOverride = "storage" in options ? options.storage : undefined;
}
