import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STUDY_FUNCTIONS, assertStudyDirectorSections } from "../../api/provision-school-account.js";
import { STUDY_FUNCTION_LABELS, studyFunctionLabel } from "../utils/studyFunction";

const refused = (fn: () => void) => {
  try { fn(); } catch (error) { return (error as { statusCode?: number }).statusCode; }
  return 0;
};

describe("lot 2 : le Directeur des études crée des enseignants seulement dans SES sections (serveur)", () => {
  const primaire = { role: "study_director", sectionIds: ["Primaire"] };

  it("accepte un enseignant dans sa section", () => {
    expect(refused(() => assertStudyDirectorSections(primaire, ["Primaire"]))).toBe(0);
  });

  it("refuse un enseignant d'une autre section (403)", () => {
    expect(refused(() => assertStudyDirectorSections(primaire, ["Secondaire"]))).toBe(403);
    expect(refused(() => assertStudyDirectorSections(primaire, ["Primaire", "Secondaire"]))).toBe(403);
  });

  it("refuse un enseignant sans section quand le directeur a des sections", () => {
    expect(refused(() => assertStudyDirectorSections(primaire, []))).toBe(403);
  });

  it("refuse de modifier un enseignant qui est déjà dans une autre section", () => {
    expect(refused(() => assertStudyDirectorSections(primaire, ["Primaire"], ["Secondaire"]))).toBe(403);
    expect(refused(() => assertStudyDirectorSections(primaire, ["Primaire"], ["Primaire"]))).toBe(0);
  });

  it("lit aussi l'ancien champ « section » d'un compte historique", () => {
    expect(refused(() => assertStudyDirectorSections({ section: "Secondaire" }, ["Secondaire"]))).toBe(0);
    expect(refused(() => assertStudyDirectorSections({ section: "Secondaire" }, ["Primaire"]))).toBe(403);
  });

  it("un compte historique sans section garde son périmètre non borné (aucune régression)", () => {
    expect(refused(() => assertStudyDirectorSections({ role: "study_director" }, ["Secondaire"]))).toBe(0);
    expect(refused(() => assertStudyDirectorSections({ role: "study_director", sectionIds: [] }, []))).toBe(0);
  });

  it("la vérification est branchée sur la création ET sur la modification d'un enseignant", () => {
    const source = readFileSync("api/provision-school-account.js", "utf8");
    expect(source).toContain("if (directorProfile) assertStudyDirectorSections(directorProfile, sectionIds);");
    expect(source).toContain('if (caller.role === "study_director") assertStudyDirectorSections(callerProfile, sectionIds,');
  });
});

describe("lot 2 : « Direction des études » et sa fonction affichée", () => {
  it("le serveur et l'écran connaissent les mêmes 4 fonctions de direction", () => {
    expect([...STUDY_FUNCTIONS].sort()).toEqual(Object.keys(STUDY_FUNCTION_LABELS).sort());
  });

  it("affiche seulement la fonction choisie", () => {
    expect(studyFunctionLabel({ role: "study_director", studyFunction: "prefect_of_studies" })).toBe("Préfet d'études");
    expect(studyFunctionLabel({ role: "study_director", studyFunction: "primary_director" })).toBe("Directeur primaire");
    expect(studyFunctionLabel({ role: "study_director", studyFunction: "nursery_director" })).toBe("Directrice maternelle");
  });

  it("un compte existant sans fonction reste « Directeur des études » (aucune donnée à modifier)", () => {
    expect(studyFunctionLabel({ role: "study_director" })).toBe("Directeur des études");
    expect(studyFunctionLabel({ role: "study_director", studyFunction: "inconnue" })).toBe("Directeur des études");
  });

  it("ne change rien pour les autres rôles", () => {
    expect(studyFunctionLabel({ role: "teacher" })).toBeUndefined();
    expect(studyFunctionLabel({ role: "school_admin", studyFunction: "prefect_of_studies" })).toBeUndefined();
  });

  it("le formulaire « Créer un personnel » propose « Direction des études » puis le champ « Fonction »", () => {
    const menu = readFileSync("src/modules/menu/MenuModule.tsx", "utf8");
    expect(menu).toContain('<option value="study_director">Direction des études</option>');
    expect(menu).toContain('{schoolUserRole === "study_director" && <label');
    expect(menu).toContain('...(schoolUserRole === "study_director" ? { studyFunction: schoolUserStudyFunction } : {}),');
  });
});
