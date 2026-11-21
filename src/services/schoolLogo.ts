import type { School } from "../types";
import { computeLogoVersion, createLogoCache, type LogoLoader, type LogoRecord, type LogoStorage } from "./logoCache";

/**
 * Logo de l'école rangé à part (voir `logoCache.ts`).
 *
 * Le logo complet est dans `schoolLogos/{id}` ; l'école garde `logoVersion` et
 * la vignette des listes `logoThumbUrl` (environ 4 Ko).
 */
export const SCHOOL_LOGO_COLLECTION = "schoolLogos";

export type SchoolLogoSource = Pick<School, "id"> & Partial<Pick<School, "logoUrl" | "logoVersion">>;
export type SchoolLogoRecord = LogoRecord;
export type SchoolLogoLoader = LogoLoader;

const cache = createLogoCache({ collection: SCHOOL_LOGO_COLLECTION, storagePrefix: "acadea.schoolLogo.", warning: "Logo de l'école indisponible." });

/** Vrai si l'école a un logo (ancien champ ou logo rangé à part). */
export const schoolHasLogo = (school: SchoolLogoSource | null | undefined) => cache.hasLogo(school);
/** Logo déjà connu, sans aucune lecture : ancien champ, mémoire ou appareil. */
export const peekSchoolLogo = (school: SchoolLogoSource | null | undefined) => cache.peek(school);
/** Logo de l'école ("" s'il n'y en a pas). Une seule lecture par version. */
export const loadSchoolLogo = (school: SchoolLogoSource | null | undefined) => cache.load(school);
/** Après un enregistrement : le nouveau logo est connu sans relecture. */
export const primeSchoolLogo = (schoolId: string, version: string, logoUrl: string) => cache.prime(schoolId, version, logoUrl);
/** Repère de version d'un logo : empreinte courte de son contenu. */
export const computeSchoolLogoVersion = computeLogoVersion;

/** Réservé aux tests. */
export function resetSchoolLogoCacheForTests(options: { loader?: SchoolLogoLoader; storage?: LogoStorage | null } = {}) {
  cache.resetForTests(options);
}
