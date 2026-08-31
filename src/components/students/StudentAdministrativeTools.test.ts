import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("outils administratifs Élèves partagés", () => {
  const tools = readFileSync(new URL("./StudentAdministrativeTools.tsx", import.meta.url), "utf8");
  const importDrawer = readFileSync(new URL("./ArchivedStudentsImportDrawer.tsx", import.meta.url), "utf8");
  const importApi = readFileSync(new URL("../../../api/_lib/archivedStudentsImport.js", import.meta.url), "utf8");
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
    expect(importDrawer).toContain("requestArchivedStudentsImport");
    expect(importDrawer).not.toContain("persistFirestorePatch");
    expect(importApi).toContain("annualStudentTransition");
    expect(tools).toContain("exportAgeHomogeneityPdf");
    expect(importApi).toContain("studentImportKey");
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
    expect(importApi).toContain("ANNUAL_COLLECTIONS.flatMap");
    expect(importApi).toContain("scoped(db, name, schoolId, sourceYearId)");
    expect(tools).toContain("student.schoolYearId === year.id");
    expect(importApi).toContain("target.students.filter((item) => studentImportKey(item) === studentImportKey(student))");
    expect(importApi).toContain("ARCHIVED_IMPORT_CHUNK_SIZE - selected.length");
    expect(importApi).not.toContain("400 - selected.length");
  });

  it("fournit deux Drawers fermables et scrollables sans nouvelle logique métier", () => {
    expect(importDrawer).toContain("export function ArchivedStudentsImportDrawer");
    expect(tools).toContain("export function AgeHomogeneityDrawer");
    expect(importDrawer).toContain('title="Importer les élèves d’une année archivée"');
    expect(tools).toContain('title="Tableau d’homogénéité d’âge"');
    expect(importDrawer).toContain("onClose={close}");
    expect(tools).toContain("onClose={onClose}");
    expect(drawer).toContain("overflow-y-auto");
  });
});
