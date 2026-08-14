import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("outils administratifs Élèves partagés", () => {
  const tools = readFileSync(new URL("./StudentAdministrativeTools.tsx", import.meta.url), "utf8");
  const studentsModule = readFileSync(new URL("../../modules/students/StudentsModule.tsx", import.meta.url), "utf8");
  const drawer = readFileSync(new URL("../ui/AdminDrawer.tsx", import.meta.url), "utf8");

  it("retire les deux points d’entrée de l’onglet Élèves sans retirer ses autres actions", () => {
    expect(studentsModule).not.toContain("Importer les élèves d'une année archivée");
    expect(studentsModule).not.toContain("Tableau d'homogénéité d'âge");
    expect(studentsModule).toContain("Ajouter un élève");
    expect(studentsModule).toContain('className="pdf-export-button min-w-0 px-3 lg:flex-1 lg:basis-0"');
    expect(studentsModule).toContain('<Download className="h-4 w-4" /> Exporter PDF');
    expect(studentsModule).toContain('<Download className="h-4 w-4" />');
    expect(studentsModule).toContain("lg:flex-1 lg:basis-0");
    expect(studentsModule).toContain("grid-cols-1 items-stretch");
    expect(studentsModule).toContain("sm:grid-cols-2 lg:flex");
    expect(studentsModule).toContain('className="max-w-full overflow-x-auto rounded border border-slate-200 bg-white"');
    expect(studentsModule).toContain("Rechercher");
  });

  it("réutilise les services, promotions et calculs PDF existants", () => {
    expect(tools).toContain("persistFirestorePatch");
    expect(tools).toContain("promoteStudentForNewYear");
    expect(tools).toContain("exportAgeHomogeneityPdf");
    expect(tools).toContain("studentImportKey");
    expect(tools).not.toContain("theoreticalAgeByClass");
    expect(tools).toContain("canonicalOperationalClasses");
  });

  it("propose toutes les classes actives et aligne les trois filtres", () => {
    expect(tools).toContain("studentBelongsToOperationalClass");
    expect(tools).not.toContain("classesWithEnrolledStudents");
    expect(tools).toContain("grid min-w-0 grid-cols-3 gap-2");
    expect(tools).toContain('className="input min-w-0" aria-label="Classe"');
  });

  it("alimente le PDF avec le meme dataset filtre et le contexte visible", () => {
    expect(tools).toContain("exportAgeHomogeneityPdf(school, year, students, {");
    expect(tools).toContain("sectionLabel:");
    expect(tools).toContain("classLabel:");
    expect(tools).toContain("statusLabel:");
  });

  it("borne l’import au Secrétaire actif, à son école et à l’année courante", () => {
    expect(tools).toContain('user.role === "secretary"');
    expect(tools).toContain('user.status === "active"');
    expect(tools).toContain("user.schoolId === school.id");
    expect(tools).toContain("student.schoolId === school.id && student.schoolYearId === sourceYearId");
    expect(tools).toContain("student.schoolYearId === year.id");
    expect(tools).toContain("existingKeys.has(key)");
  });

  it("fournit deux Drawers fermables et scrollables sans nouvelle logique métier", () => {
    expect(tools).toContain("export function ArchivedStudentsImportDrawer");
    expect(tools).toContain("export function AgeHomogeneityDrawer");
    expect(tools).toContain('title="Importer les élèves d’une année archivée"');
    expect(tools).toContain('title="Tableau d’homogénéité d’âge"');
    expect(tools).toContain("onClose={closeDrawer}");
    expect(tools).toContain("onClose={onClose}");
    expect(drawer).toContain("overflow-y-auto");
  });
});
