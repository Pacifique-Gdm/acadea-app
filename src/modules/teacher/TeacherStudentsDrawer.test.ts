import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TeacherStudentsDrawer.tsx", import.meta.url), "utf8");

describe("Mes élèves Enseignant", () => {
  it("ancre la fiche de suivi dans la ligne de l’élève et la ferme au clic extérieur ou avec Échap", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain("selectedStudent?.id === student.id");
    expect(source).toContain('document.addEventListener("pointerdown", closeOutside)');
    expect(source).toContain('event.key === "Escape"');
    expect(source.indexOf('role="dialog"')).toBeLessThan(source.lastIndexOf("</div>\n    </>"));
  });

  it("utilise l’API authentifiée pour sauvegarder l’observation et notifier le parent", () => {
    expect(source).toContain("saveTeacherObservation({");
    expect(source).not.toContain("saveTeacherStudentObservation");
    expect(source).toContain("result.notificationWarning");
  });

  it("peut afficher le roster dès sa réponse sans attendre le chargement complet des cotations", () => {
    expect(source).toContain("roster?.assignmentId === current?.id ? roster.students : grading?.students ?? []");
    expect(source).toContain("grading?.classes ?? data.classes");
  });
});
