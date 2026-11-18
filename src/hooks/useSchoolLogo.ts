import { useEffect, useState } from "react";
import { loadSchoolLogo, peekSchoolLogo, type SchoolLogoSource } from "../services/schoolLogo";

/** Logo de l'école pour l'affichage : lu seulement quand un écran l'affiche. */
export function useSchoolLogo(school: SchoolLogoSource | null | undefined): string {
  const id = school?.id ?? "";
  const legacy = school?.logoUrl ?? "";
  const version = school?.logoVersion ?? "";
  const [loaded, setLoaded] = useState<{ key: string; logoUrl: string }>({ key: "", logoUrl: "" });
  const key = `${id}|${version}|${legacy.length}`;
  const known = school ? peekSchoolLogo({ id, logoUrl: legacy, logoVersion: version }) : "";

  useEffect(() => {
    if (!id || known !== undefined) return undefined;
    let active = true;
    void loadSchoolLogo({ id, logoUrl: legacy, logoVersion: version }).then((logoUrl) => {
      if (active) setLoaded({ key, logoUrl });
    });
    return () => { active = false; };
  }, [id, key, known, legacy, version]);

  if (known !== undefined) return known;
  return loaded.key === key ? loaded.logoUrl : "";
}
