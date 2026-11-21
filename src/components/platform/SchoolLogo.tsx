import type { School } from "../../types";
import { useSchoolLogo } from "../../hooks/useSchoolLogo";
import { isValidLogoThumbnail } from "../../services/logoThumbnail";

function buildAcronym(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

/**
 * Logo de l'école. Dans les listes, la petite vignette rangée dans l'école
 * suffit (aucune lecture en plus) ; `full` (drawer de l'école) lit le logo complet.
 * Une école sans vignette (pas encore migrée) affiche le logo complet, comme avant.
 */
export function SchoolLogo({ school, full = false }: { school: School; full?: boolean }) {
  const thumbnail = !full && isValidLogoThumbnail(school.logoThumbUrl) ? school.logoThumbUrl : "";
  const completeLogo = useSchoolLogo(thumbnail ? null : school);
  const logoUrl = thumbnail || completeLogo;
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 text-sm font-bold text-ink">
      {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-cover" /> : school.acronym ?? buildAcronym(school.name)}
    </div>
  );
}
