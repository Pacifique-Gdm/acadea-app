import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Student } from "../types";
import { useStudentPage } from "./useStudentPage";
import type { StudentQueryFilters } from "../services/studentPagination";
import { readFileSync } from "node:fs";
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));
const filters = { schoolId: "a", schoolYearId: "y", actorRole: "primary_admin", allowedSections: ["Primaire"], section: "all", archive: "all", search: "", className: "", option: "" } as StudentQueryFilters;
const student = (id: string, section: string) => ({ id, schoolId: "a", schoolYearId: "y", section, nom: id, postnom: "", prenom: "", className: "1ère Primaire" }) as Student;
function Probe() {
  const result = useStudentPage(filters, [student("allowed", "Primaire"), student("forbidden", "Secondaire")]);
  return createElement("div", null, `${result.loading}:${result.total}:${result.students.map((item) => item.id).join()}`);
}
describe("liste Élèves alimentée par le serveur de section", () => {
  it("rend les seuls élèves autorisés sans chargement Firestore parallèle", () => {
    expect(renderToStaticMarkup(createElement(Probe))).toContain("false:1:allowed");
    const source = readFileSync(new URL("./useStudentPage.ts", import.meta.url), "utf8");
    expect(source).toContain("if (!remoteEnabled) { setLoading(false); return; }");
    expect(source).toContain("if (!remoteEnabled) return;");
  });
  it("relit les données sur le serveur avant tout PDF de section", () => {
    const source = readFileSync(new URL("../modules/students/StudentsModule.tsx", import.meta.url), "utf8");
    expect(source).toContain('filterStudentFallback(await loadSectionSchoolRecords("students", user, school.id, year.id), studentFilters)');
    expect(source).toContain("assertSectionStudentPdfScope(user, school.id, year.id, exportStudents)");
  });
});
