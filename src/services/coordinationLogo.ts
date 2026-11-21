import type { Coordination } from "../types";
import { createLogoCache, type LogoLoader, type LogoStorage } from "./logoCache";

/**
 * Logo de la coordination rangé à part, comme celui des écoles.
 *
 * Le logo complet est dans `coordinationLogos/{id}` (écrit par le serveur
 * seulement) ; la coordination garde `logoVersion` et la vignette `logoThumbUrl`.
 */
export const COORDINATION_LOGO_COLLECTION = "coordinationLogos";
/** Identifiant de l'établissement des PDF de la coordination : `coordination:{id}`. */
export const COORDINATION_PDF_ID_PREFIX = "coordination:";

export type CoordinationLogoSource = Pick<Coordination, "id"> & Partial<Pick<Coordination, "logoUrl" | "logoVersion">>;

const cache = createLogoCache({ collection: COORDINATION_LOGO_COLLECTION, storagePrefix: "acadea.coordinationLogo.", warning: "Logo de la coordination indisponible." });

export const peekCoordinationLogo = (coordination: CoordinationLogoSource | null | undefined) => cache.peek(coordination);
export const loadCoordinationLogo = (coordination: CoordinationLogoSource | null | undefined) => cache.load(coordination);
export const primeCoordinationLogo = (coordinationId: string, version: string, logoUrl: string) => cache.prime(coordinationId, version, logoUrl);

/** Réservé aux tests. */
export function resetCoordinationLogoCacheForTests(options: { loader?: LogoLoader; storage?: LogoStorage | null } = {}) {
  cache.resetForTests(options);
}
