import { useEffect, useState } from "react";
import type { LogoSource } from "../services/logoCache";
import { loadSchoolLogo, peekSchoolLogo, type SchoolLogoSource } from "../services/schoolLogo";

/** Logo complet lu seulement quand un écran l'affiche (école ou coordination). */
export function useCachedLogo(
  source: LogoSource | null | undefined,
  peek: (source: LogoSource) => string | undefined,
  load: (source: LogoSource) => Promise<string>,
): string {
  const id = source?.id ?? "";
  const legacy = source?.logoUrl ?? "";
  const version = source?.logoVersion ?? "";
  const [loaded, setLoaded] = useState<{ key: string; logoUrl: string }>({ key: "", logoUrl: "" });
  const key = `${id}|${version}|${legacy.length}`;
  const known = source ? peek({ id, logoUrl: legacy, logoVersion: version }) : "";

  useEffect(() => {
    if (!id || known !== undefined) return undefined;
    let active = true;
    void load({ id, logoUrl: legacy, logoVersion: version }).then((logoUrl) => {
      if (active) setLoaded({ key, logoUrl });
    });
    return () => { active = false; };
  }, [id, key, known, legacy, load, version]);

  if (known !== undefined) return known;
  return loaded.key === key ? loaded.logoUrl : "";
}

/** Logo de l'école pour l'affichage : lu seulement quand un écran l'affiche. */
export function useSchoolLogo(school: SchoolLogoSource | null | undefined): string {
  return useCachedLogo(school, peekSchoolLogo, loadSchoolLogo);
}
