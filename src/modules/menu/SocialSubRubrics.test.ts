// F2 (décisions de l'utilisateur du 27/11/2026) : sous-rubriques pour toute rubrique, depuis le drawer de la rubrique,
// et sous-rubriques des cas sociaux dans la partie 2.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sameSocialSubOverrides, socialSubLines, socialSubPayload } from "./SocialSubRubrics";
import type { SubRubric } from "./SubRubricsPanel";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const subs: SubRubric[] = [{ id: "1111111111111111", name: "Ouvrier", mode: "fixed", fixedMinor: 500, functions: [] }, { id: "2222222222222222", name: "Enseignant", mode: "percent", basisPoints: 5000, functions: [] }];

describe("F2 — sous-rubriques des cas sociaux (écran)", () => {
  it("les lignes sont reprises de la partie 1, avec les écarts déjà publiés", () => {
    expect(socialSubLines(subs)).toEqual([{ id: subs[0].id, name: "Ouvrier", mode: "fixed", value: "5" }, { id: subs[1].id, name: "Enseignant", mode: "percent", value: "50" }]);
    expect(socialSubLines(subs, { [subs[0].id]: { removed: true }, [subs[1].id]: { mode: "percent", basisPoints: 2000 } }))
      .toEqual([{ id: subs[0].id, name: "Ouvrier", mode: "fixed", value: "5", removed: true }, { id: subs[1].id, name: "Enseignant", mode: "percent", value: "20" }]);
  });
  it("seuls les écarts avec la partie 1 partent au serveur ; erreurs lisibles", () => {
    expect(socialSubPayload(socialSubLines(subs), subs)).toEqual({ overrides: {} });
    const lines = socialSubLines(subs).map((line, i) => i ? { ...line, value: "20" } : { ...line, removed: true });
    expect(socialSubPayload(lines, subs)).toEqual({ overrides: { [subs[0].id]: { removed: true }, [subs[1].id]: { mode: "percent", basisPoints: 2000 } } });
    expect(socialSubPayload([{ ...lines[1], value: "120" }], subs)).toEqual({ error: "Pourcentage supérieur à 100 % pour « Enseignant »." });
    expect(socialSubPayload([{ ...lines[1], value: "abc" }], subs)).toHaveProperty("error");
    expect(sameSocialSubOverrides({}, undefined)).toBe(true);
    expect(sameSocialSubOverrides({ [subs[0].id]: { removed: true } }, {})).toBe(false);
  });
  it("la partie 2 montre les sous-rubriques sous chaque rubrique et les publie avec la seule phrase « PUBLIER LA PARTIE DEUX »", () => {
    const social = read("./FeeAllocationSocialPart.tsx");
    expect(social).toContain("<SocialSubRubricsBlock");
    expect(social).toContain("socialSubRubrics: Object.fromEntries(modifiedSubs");
    expect(social).toContain("confirmation === SOCIAL_PUBLISH_PHRASE");
    expect(read("./SocialSubRubrics.tsx")).not.toContain("ENREGISTRER LES SOUS-RUBRIQUES");
  });
});

describe("F2 — accès aux sous-rubriques", () => {
  it("le drawer d'une rubrique a le bouton, seul et pleine largeur ; rien sans répartition activée", () => {
    const drawer = read("./FeeAllocationDrawer.tsx"), panel = read("./SubRubricsPanel.tsx");
    expect(drawer).toContain("<RubricSubRubricsAccess schoolId={workspaces[0].school.id} rubricId={detail.rubricId} active={!!workspaces[0].ledger}");
    expect(panel).toContain(': count ? `Sous-rubriques (${count})` : "Ajouter sous-rubriques"}');
    expect(panel).toContain('<span className={BUTTON_ROW}><button type="button" className="secondary-button w-full justify-center" aria-expanded={open}');
    expect(panel).toContain("Les sous-rubriques seront disponibles quand la répartition sera activée.");
  });
  it("l'ancien bouton « Sous-rubriques » a quitté « Rubriques de l'année » ; « Consulter les versions » et « Partie 2 » se partagent la largeur", () => {
    expect(read("./RubricCatalogPanel.tsx")).not.toContain("SubRubricsSection");
    const drawer = read("./FeeAllocationDrawer.tsx");
    expect(drawer).toContain('<div className={BUTTON_ROW}><Action className="secondary-button w-full min-w-0 justify-items-center whitespace-normal px-2"');
    expect(drawer).toContain('>Consulter les versions</Action>{socialPartAllowed && config.currentVersionId && <button type="button" className="secondary-button w-full min-w-0 justify-center whitespace-normal px-2" data-social-part-detail');
  });
  it("« Fonctions concernées » est facultatif (sert seulement à la paie)", () => {
    expect(read("./SubRubricsPanel.tsx")).toContain("Fonctions concernées (facultatif, sert seulement à proposer la sous-rubrique dans la paie)");
  });
});
