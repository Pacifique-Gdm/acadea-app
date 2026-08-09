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
    expect(source).toContain('className="sticky top-0 z-10 shrink-0 bg-white pb-1"');
    expect(source).toContain("overflow-y-auto overscroll-contain");
  });

  it("conditionne l'édition et préremplit le formulaire existant", () => {
    expect(source).toContain("canManageStudentMedicalRecords(user, schoolId)");
    expect(source).toContain("canEditMedicalRecords &&");
    expect(source).toContain("setInput(normalizeMedicalRecordInput(record))");
    expect(source).toContain("student.schoolId === schoolId && student.schoolYearId === schoolYearId");
  });

  it("contient tous les champs médicaux et un verrou anti-double soumission", () => {
    const labels = medicalRecordSections.flatMap((section) => section.fields.map((field) => field.label));
    expect(labels).toEqual(["Groupe sanguin", "Rhésus (optionnel)", "Taille", "Poids", "Antécédents médicaux", "Allergies", "Maladies chroniques", "Traitements en cours", "Handicap ou besoin particulier", "Vaccinations", "Observations médicales", "Contact d'urgence", "Téléphone du contact d'urgence", "Lien avec l'élève", "Médecin traitant", "Téléphone du médecin", "Centre de santé de référence"]);
    expect(source).toContain("saveLock.current");
  });

  it("masque Créer dès la sauvegarde et réserve Modifier à la vue détaillée", () => {
    expect(source).toContain("setSavedStudentIds((current) => new Set(current).add(editingStudent.id))");
    expect(source).toContain("!record && !savedStudentIds.has(student.id)");
    expect(source).not.toContain('{record ? "Modifier" : "Créer"}');
    expect(source).toContain("canEditMedicalRecords && viewingRecord");
    expect(source).toContain("setViewingStudent(editingStudent)");
    expect(source).toContain("setOptimisticRecords");
    expect(source).toContain("medicalRecordSaveErrorMessage(error)");
  });

  it("place Imprimer à droite de Modifier et utilise le PDF Acadéa", () => {
    const actions = source.slice(source.indexOf('className="flex flex-wrap justify-end gap-2"'), source.indexOf('<MedicalRecordFields mode="view"'));
    expect(actions.indexOf("Modifier")).toBeGreaterThan(-1);
    expect(actions.indexOf("Imprimer")).toBeGreaterThan(actions.indexOf("Modifier"));
    expect(actions).toContain("renderAcadPdfPreview");
    expect(actions).toContain('title: "FICHE MÉDICALE"');
    expect(actions).toContain("medicalRecordPdfSections(viewingStudent, viewingRecord)");
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

  it("affiche une liste déroulante unique et la réinitialisation iconique", () => {
    const allIndex = source.indexOf('<option value="all">Toutes</option>');
    const sectionIndex = source.indexOf('<option value="section">Section</option>');
    const classIndex = source.indexOf('<option value="class">Classe précise</option>');
    const resetIndex = source.indexOf('aria-label="Réinitialiser le filtre"');
    const exportIndex = source.indexOf("> Exporter PDF</button>");
    expect(allIndex).toBeGreaterThan(-1);
    expect(sectionIndex).toBeGreaterThan(allIndex);
    expect(classIndex).toBeGreaterThan(sectionIndex);
    expect(resetIndex).toBeGreaterThan(classIndex);
    expect(exportIndex).toBeGreaterThan(resetIndex);
    expect(source).toContain('className="sticky top-0 z-20 grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] gap-2 border-b border-slate-100 bg-white pb-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_2.5rem_minmax(9rem,auto)]"');
    expect(source).toContain('className="input h-10 min-w-0 w-full"');
    expect(source).toContain("pdf-export-button col-span-2 h-10 w-full sm:col-span-1");
    expect(source).toContain('<Download className="h-4 w-4" /> Exporter PDF');
    expect(source).toContain('<select aria-label="Type de filtre"');
    expect(source).toContain('value={filterType}');
    expect(source).toContain("selectFilterType(event.target.value as typeof filterType)");
    expect(source).not.toContain('role="group" aria-label="Type de filtre"');
    expect(source).not.toContain("grid-cols-3");
    expect(source).not.toContain("aria-pressed");
    expect(source).toContain('title="Réinitialiser le filtre"');
    expect(source).toContain("<RotateCcw");
    expect(source).toContain("getSchoolSections(school)");
    expect(source).toContain("getSchoolClassChoices(school)");
    expect(source).toContain("buildValveClassChoices(scopedStudents");
    expect(source).not.toContain("> Filtrer</button>");
    expect(source).not.toContain("filterOpen");
    expect(source).not.toContain("setFilterOpen");
    expect(source).not.toContain('bg-blue-50 p-3 text-sm font-bold text-blue-800">{scopeLabel}');
    expect(source).not.toContain("RÉINITIALISER LE FILTRE");
    expect(source).toContain('function resetFilter() { setFilterType("all"); setSelectedSection(""); setSelectedClassKey(""); }');
    expect(source).toContain('useState<"all" | "section" | "class">("all")');
    expect(source).toContain("sections.map((section)");
    expect(source).toContain("classes.map((item)");
  });

  it("utilise les mêmes statistiques filtrées pour l'écran et le PDF", () => {
    expect(source).toContain("student.schoolId === school.id && student.schoolYearId === year.id");
    expect(source).toContain("filterSecretaryStatisticsStudents(scopedStudents, activeFilter)");
    expect(source).toContain("buildSecretaryStatistics(filteredStudents");
    expect(source).toContain('title: "STATISTIQUES"');
    expect(source).toContain("subtitle: scopeLabel");
    expect(source).toContain("statistics.cards.map");
    expect(source).toContain("Aucune donnée statistique pour le filtre sélectionné.");
    expect(source).toContain('pdfSection("Synthèse"');
    expect(source).toContain('pdfSection("Répartition par classe", pdfTable');
    expect(source).toContain('pdfSection("Répartition par niveau", pdfTable');
    expect(source).not.toContain('pdfSection("SYNTHÈSE"');
    expect(source).not.toContain('pdfSection("RÉPARTITION PAR CLASSE"');
    expect(source).not.toContain('pdfSection("RÉPARTITION PAR NIVEAU"');
    const classTable = source.slice(source.indexOf('pdfSection("Répartition par classe"'), source.indexOf('pdfSection("Répartition par niveau"'));
    const sectionTable = source.slice(source.indexOf('pdfSection("Répartition par niveau"'), source.indexOf("function resetFilter"));
    expect(Array.from(classTable.matchAll(/header: "([^"]+)"/g), (match) => match[1])).toEqual(["ORDRE", "SECTION", "CLASSE", "OPTION", "EFFECTIF", "POURCENTAGE"]);
    expect(Array.from(sectionTable.matchAll(/header: "([^"]+)"/g), (match) => match[1])).toEqual(["ORDRE", "SECTION", "EFFECTIF", "POURCENTAGE"]);
    expect(sectionTable).toContain('{ pageBreakBefore: true, className: "statistics-pdf-section" }');
    expect(classTable).toContain('{ className: "statistics-pdf-section" }');
    expect(classTable).not.toContain("pageBreakBefore");
    expect(source).toContain("statistics.classRows");
    expect(source).toContain("statistics.sectionRows");
    expect(source).not.toContain("statistics.levelRows");
    const pdfSource = readFileSync(new URL("../../utils/pdf.ts", import.meta.url), "utf8");
    expect(pdfSource).toContain("letter-spacing: normal !important");
    expect(pdfSource).toContain(".pdf-section.statistics-pdf-section h2");
    expect(pdfSource).toContain("letter-spacing: normal");
    expect(pdfSource).toContain("word-spacing: 0.12em !important");
    expect(pdfSource).toContain("await document.fonts.ready");
    expect(pdfSource).toContain("await html2canvas(element");
    expect(pdfSource).toContain("white-space: normal");
    expect(pdfSource).toContain("overflow-wrap: normal");
    expect(source).not.toContain("Répartitionpar classe");
    expect(source).not.toContain("Répartitionpar niveau");
    expect(source).toContain('className: "statistics-pdf-section statistics-summary-pdf-section"');
    expect(pdfSource).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
    expect(pdfSource).toContain("font-variant-ligatures: normal");
  });
});
