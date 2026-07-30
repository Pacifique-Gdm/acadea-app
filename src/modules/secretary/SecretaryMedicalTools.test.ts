import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyMedicalRecordInput, formatMedicalRecordValue, medicalRecordSections, normalizeMedicalRecordInput } from "./medicalRecordFields";

describe("Drawers médicaux et statistiques du Secrétaire", () => {
  const source = readFileSync(new URL("./SecretaryMedicalTools.tsx", import.meta.url), "utf8");

  it("réutilise AdminDrawer pour la liste, la consultation, le formulaire et les statistiques", () => {
    expect(source.match(/<AdminDrawer/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('title="Fiches médicales"');
    expect(source).toContain('title="Statistiques"');
  });

  it("présente la recherche, les statuts et remplace Consulter par un nom accessible", () => {
    for (const label of ["Rechercher un élève", "Complète", "Incomplète", "Non créée", "Modifier", "Créer"]) expect(source).toContain(label);
    expect(source).not.toContain(">Consulter</button>");
    expect(source).toContain("setViewingStudent(student)");
    expect(source).toContain("aria-label={`Consulter la fiche médicale de");
    expect(source).toContain("focus-visible:ring-2");
  });

  it("conditionne l'édition et préremplit le formulaire existant", () => {
    expect(source).toContain('user.role === "secretary"');
    expect(source).toContain('user.status !== "inactive"');
    expect(source).toContain("user.schoolId === schoolId");
    expect(source).toContain("canEditMedicalRecords &&");
    expect(source).toContain("setInput(normalizeMedicalRecordInput(record))");
    expect(source).toContain("student.schoolId === schoolId && student.schoolYearId === schoolYearId");
  });

  it("contient tous les champs médicaux et un verrou anti-double soumission", () => {
    const labels = medicalRecordSections.flatMap((section) => section.fields.map((field) => field.label));
    expect(labels).toEqual(["Groupe sanguin", "Rhésus (optionnel)", "Allergies", "Maladies chroniques", "Traitements en cours", "Handicap ou besoin particulier", "Vaccinations", "Observations médicales", "Contact d'urgence", "Téléphone du contact d'urgence", "Lien avec l'élève", "Médecin traitant", "Téléphone du médecin", "Centre de santé de référence"]);
    expect(source).toContain("saveLock.current");
  });

  it("pilote création, modification et consultation avec la même configuration", () => {
    expect(source.match(/medicalRecordSections\.map/g)).toHaveLength(1);
    expect(source).toContain('<MedicalRecordFields mode="edit"');
    expect(source).toContain('<MedicalRecordFields mode="view"');
    const configuredFields = medicalRecordSections.flatMap((section) => section.fields.map((field) => field.key));
    expect(configuredFields).toEqual(Object.keys(emptyMedicalRecordInput));
    expect(medicalRecordSections.map((section) => section.title)).toEqual(["Informations médicales", "Urgence", "Suivi médical"]);
  });

  it("normalise une ancienne fiche incomplète sans produire de valeur undefined", () => {
    const normalized = normalizeMedicalRecordInput({ bloodGroup: "O+", allergies: undefined as unknown as string });
    expect(normalized.bloodGroup).toBe("O+");
    expect(normalized.allergies).toBe("");
    expect(Object.values(normalized)).not.toContain(undefined);
    expect(formatMedicalRecordValue(undefined)).toBe("Non renseigné");
    expect(formatMedicalRecordValue(true)).toBe("Oui");
    expect(formatMedicalRecordValue(false)).toBe("Non");
    expect(formatMedicalRecordValue(["A", "B"])).toBe("A, B");
  });

  it("place FILTRER puis EXPORTER PDF sur la même barre et expose les filtres dynamiques", () => {
    const filterIndex = source.indexOf("> FILTRER</button>");
    const exportIndex = source.indexOf("> EXPORTER PDF</button>");
    expect(filterIndex).toBeGreaterThan(-1);
    expect(exportIndex).toBeGreaterThan(filterIndex);
    expect(source).toContain('className="flex flex-wrap items-center gap-2"');
    expect(source).toContain("getSchoolSections(school)");
    expect(source).toContain("getSchoolClassChoices(school)");
    expect(source).toContain("buildValveClassChoices(scopedStudents");
    expect(source).toContain("TOUTES LES SECTIONS ET CLASSES");
    expect(source).toContain("CLASSE PRÉCISE");
    expect(source).toContain("RÉINITIALISER LE FILTRE");
  });

  it("utilise les mêmes statistiques filtrées pour l'écran et le PDF", () => {
    expect(source).toContain("student.schoolId === school.id && student.schoolYearId === year.id");
    expect(source).toContain("filterSecretaryStatisticsStudents(scopedStudents, activeFilter)");
    expect(source).toContain("buildSecretaryStatistics(filteredStudents");
    expect(source).toContain('title: "STATISTIQUES"');
    expect(source).toContain("subtitle: scopeLabel");
    expect(source).toContain("statistics.cards.map");
    expect(source).toContain("Aucune donnée statistique pour le filtre sélectionné.");
    expect(source).toContain('pdfSection("RÉPARTITION PAR CLASSE", pdfTable');
    expect(source).toContain('pdfSection("RÉPARTITION PAR NIVEAU", pdfTable');
    const classTable = source.slice(source.indexOf('pdfSection("RÉPARTITION PAR CLASSE"'), source.indexOf('pdfSection("RÉPARTITION PAR NIVEAU"'));
    const sectionTable = source.slice(source.indexOf('pdfSection("RÉPARTITION PAR NIVEAU"'), source.indexOf("function resetFilter"));
    expect(Array.from(classTable.matchAll(/header: "([^"]+)"/g), (match) => match[1])).toEqual(["ORDRE", "SECTION", "CLASSE", "OPTION", "EFFECTIF", "POURCENTAGE"]);
    expect(Array.from(sectionTable.matchAll(/header: "([^"]+)"/g), (match) => match[1])).toEqual(["ORDRE", "SECTION", "EFFECTIF", "POURCENTAGE"]);
    expect(sectionTable).toContain("{ pageBreakBefore: true }");
    expect(classTable).not.toContain("pageBreakBefore");
    expect(source).toContain("statistics.classRows");
    expect(source).toContain("statistics.sectionRows");
    expect(source).not.toContain("statistics.levelRows");
  });
});
