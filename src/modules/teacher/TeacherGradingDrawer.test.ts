import{readFileSync}from"node:fs";import{describe,expect,it}from"vitest";
import { reconcileGradeDrafts } from "./teacherGrading";
describe("Fiche de cotation Enseignant",()=>{const portal=readFileSync(new URL("./TeacherPortal.tsx",import.meta.url),"utf8"),drawer=readFileSync(new URL("./TeacherGradingDrawer.tsx",import.meta.url),"utf8"),api=readFileSync(new URL("../../../api/_lib/teacherGrading.js",import.meta.url),"utf8");it("reste dans Menu sans cinquième onglet",()=>{expect(portal).toContain("Fiche de cotation");expect(portal).toContain("TeacherGradingDrawer");expect(portal).not.toContain('id: "grading"')});it("utilise une liste mobile verticale et les états attendus",()=>{expect(drawer).toContain("grid gap-2 rounded border");expect(drawer).toContain("Aucun cours ne vous a encore été affecté");expect(drawer).toContain("Définissez la cote maximale");expect(drawer).toContain("Ma classe titulaire")});it("n'expose que les six slots éditables fournis par le domaine",()=>expect(drawer).toContain("editableGradingSlots.map"));it("traite l'absence d'affectation comme un état vide sans lectures secondaires",()=>{expect(drawer).toContain("Aucune affectation n’est disponible pour cet enseignant");expect(api).toContain("if (assignments.length === 0 && titulars.length === 0)");expect(api).toContain("subjects: [], classes: [], students: [], configs: [], entries: []")})});

describe("Actualisation des élèves de la fiche", () => {
  const drawer = readFileSync(new URL("./TeacherGradingDrawer.tsx", import.meta.url), "utf8");
  const rosterHook = readFileSync(new URL("./useTeacherGradingRoster.ts", import.meta.url), "utf8");
  const studentsDrawer = readFileSync(new URL("./TeacherStudentsDrawer.tsx", import.meta.url), "utf8");
  it("rafraîchit seulement le cours sélectionné sans reload et nettoie l'intervalle au démontage", () => {
    expect(drawer).toContain("useTeacherGradingRoster(assignment, school.id, year.id)");
    expect(studentsDrawer).toContain("useTeacherGradingRoster(current, school.id, year.id)");
    expect(rosterHook).toContain("loadTeacherGradingRoster({ schoolId, schoolYearId, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId })");
    expect(rosterHook).toContain("window.setInterval(() => void refreshRoster(), 30_000)");
    expect(rosterHook).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
    expect(rosterHook).toContain("window.clearInterval(interval)");
    expect(drawer).toContain("roster?.assignmentId === assignment.id ? roster.students : data.students");
    expect(studentsDrawer).toContain("roster?.assignmentId === current.id ? roster.students : grading.students");
    expect(drawer).not.toContain("window.location.reload()");
  });
  it("ajoute un nouvel élève sans effacer une cote non encore enregistrée", () => {
    const students = [{ id: "existing" }, { id: "new" }] as Parameters<typeof reconcileGradeDrafts>[0];
    const previous = { existing: { score: "8", status: "graded" as const } };
    expect(reconcileGradeDrafts(students, [], previous, false)).toEqual({
      existing: previous.existing,
      new: { score: "", status: "not_graded" },
    });
    expect(reconcileGradeDrafts(students, [], previous, true).existing).toEqual({ score: "", status: "not_graded" });
  });
});
