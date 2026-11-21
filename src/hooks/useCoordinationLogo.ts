import { loadCoordinationLogo, peekCoordinationLogo, type CoordinationLogoSource } from "../services/coordinationLogo";
import { isValidLogoThumbnail } from "../services/logoThumbnail";
import { useCachedLogo } from "./useSchoolLogo";

/** Logo complet de la coordination (drawer, paramètres) : lu seulement à l'affichage. */
export function useCoordinationLogo(coordination: CoordinationLogoSource | null | undefined): string {
  return useCachedLogo(coordination, peekCoordinationLogo, loadCoordinationLogo);
}

/**
 * Petit logo (listes, en-tête) : la vignette rangée dans la coordination suffit.
 * Sans vignette (pas encore migrée), le logo complet est affiché comme avant.
 */
export function useCoordinationLogoThumbnail(coordination: (CoordinationLogoSource & { logoThumbUrl?: string }) | null | undefined): string {
  const thumbnail = coordination && isValidLogoThumbnail(coordination.logoThumbUrl) ? coordination.logoThumbUrl : "";
  const complete = useCoordinationLogo(thumbnail ? null : coordination);
  return thumbnail || complete;
}
