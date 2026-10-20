import{readFileSync}from"node:fs";import{describe,expect,it}from"vitest";
import { reconcileGradeDrafts } from "./teacherGrading";
describe("Fiche de cotation Enseignant",()=>{const portal=readFileSync(new URL("./TeacherPortal.tsx",import.meta.url),"utf8"),drawer=readFileSync(new URL("./TeacherGradingDrawer.tsx",import.meta.url),"utf8"),api=readFileSync(new URL("../../../api/_lib/teacherGrading.js",import.meta.url),"utf8");it("reste dans Menu sans cinquième onglet",()=>{expect(portal).toContain("Fiche de cotation");expect(portal).toContain("TeacherGradingDrawer");expect(portal).not.toContain('id: "grading"')});it("utilise une liste mobile verticale et les états attendus",()=>{expect(drawer).toContain("grid gap-2 rounded border");expect(drawer).toContain("Aucun cours ne vous a encore été affecté");expect(drawer).toContain("Définissez la cote maximale");expect(drawer).toContain("Ma classe titulaire")});it("n'expose que les six slots éditables fournis par le domaine",()=>expect(drawer).toContain("editableGradingSlots.map"));it("traite l'absence d'affectation comme un état vide sans lectures secondaires",()=>{expect(drawer).toContain("Aucun cours ne vous a encore été affecté");expect(drawer).toContain("Aucune classe titulaire");expect(api).toContain("if (assignments.length === 0 && titulars.length === 0)");expect(api).toContain("subjects: [], classes: [], students: [], configs: [], entries: []")})});

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
    expect(studentsDrawer).toContain("roster?.assignmentId === current?.id ? roster.students : grading?.students ?? []");
    expect(drawer).not.toContain("window.location.reload()");
  });

  it("laisse la saisie d’une cote non cotée active et verrouille seulement le statut absent", () => {
    expect(drawer).toContain('disabled={saving || confirmation === "grade" || value.status === "absent"}');
    expect(drawer).not.toContain('disabled={value.status !== "graded"}');
    expect(drawer).toContain('status: event.target.value === "" ? "not_graded" : "graded"');
  });

  it("affiche immédiatement le shell depuis les données déjà chargées du portail", () => {
    expect(drawer).toContain("portalData: TeacherPortalData");
    expect(drawer).toContain("const initialData = useMemo");
    expect(drawer).not.toContain("!loading && data && <div");
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

describe("ergonomie des confirmations de cotation", () => {
  const drawer = readFileSync(new URL("./TeacherGradingDrawer.tsx", import.meta.url), "utf8");
  it("verrouille le maximum persisté en gardant sa valeur lisible", () => {
    expect(drawer).not.toContain('blur-sm');
    expect(drawer).toContain('readOnly={Boolean(config) && !editingMaxScore}');
  });
  it("ancre chaque confirmation auprès de son action et efface les succès temporaires", () => {
    expect(drawer).toContain('{confirmationPanel("maximum")}');
    expect(drawer).toContain('{confirmationPanel("grade")}');
    expect(drawer).toContain('window.setTimeout(() => setSuccess(""), 4000)');
    expect(drawer).toContain('window.clearTimeout(timeout)');
    expect(drawer).toContain('confirmationText !== maxScoreConfirmation(Boolean(config))');
  });
  it("présente les deux choix même sans titulariat", () => {
    expect(drawer).toContain('className="grid grid-cols-2 gap-2"');
    expect(drawer).toContain('"primary-button w-full justify-center"');
    expect(drawer).toContain('Aucune classe titulaire');
  });
  it("place l'ouverture de la fiche consolidée au bas de la carte titulaire", () => {
    const card = drawer.slice(drawer.indexOf('<article className="rounded border bg-white p-3">'));
    expect(card.indexOf('Voir la fiche consolidée')).toBeGreaterThan(card.indexOf('élève(s)'));
    expect(card.indexOf('Voir la fiche consolidée')).toBeLessThan(card.indexOf('</article>'));
    expect(card).toContain('className="secondary-button mt-3 w-full justify-center"');
  });
});
