import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIRST_STUDENTS, groupsForStudents, nameCollator, OFFSCREEN_CLASS_STYLE, studentsIn } from "./DisciplineAttendanceDrawer";

// Lot « Présence rapide » : l'onglet Présence du Directeur de Discipline.
const portal = readFileSync(new URL("../../modules/discipline/DisciplinePortal.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("./DisciplineAttendanceDrawer.tsx", import.meta.url), "utf8");

describe("onglet Présence rapide", () => {
  it("reste en mémoire après sa première ouverture : pas de reconstruction au retour", () => {
    expect(portal).not.toContain('{activeDisciplineTab === "attendance" && (');
    expect(portal).toContain('<div hidden={activeDisciplineTab !== "attendance"} data-attendance-tab');
    expect(portal).toContain('if (activeDisciplineTab === "attendance") attendanceVisited.current = true;');
  });
  it("n'est pas redessiné à chaque changement d'onglet : composant mémorisé, valeurs stables", () => {
    expect(drawer).toContain("export const DisciplineAttendanceDrawer = memo(DisciplineAttendanceView);");
    expect(portal).toContain("allowedSections={attendanceSections}");
    expect(portal).toContain("onSaveManualAttendance={stableSaveManualAttendance}");
    expect(portal).not.toContain("allowedSections={userSectionIds(user)}");
  });
  it("dessine d'abord les premières classes (≈ 40 élèves), puis les suivantes par morceaux", () => {
    const groups = [12, 30, 25, 40].map((n) => ({ students: Array.from({ length: n }) }));
    expect(groupsForStudents(groups, FIRST_STUDENTS)).toBe(2);
    expect(groupsForStudents([{ students: Array.from({ length: 300 }) }], FIRST_STUDENTS)).toBe(1);
    expect(groupsForStudents([], FIRST_STUDENTS)).toBe(0);
    expect(studentsIn(groups, 2)).toBe(42);
    expect(drawer).toContain("groupedStudents.slice(0, shownGroups).map((group) => (");
  });
  it("une classe hors de l'écran n'est mise en page qu'au défilement", () => {
    expect(OFFSCREEN_CLASS_STYLE.contentVisibility).toBe("auto");
    expect(drawer).toContain("style={OFFSCREEN_CLASS_STYLE} data-attendance-class");
  });
  it("trie avec des comparateurs créés une seule fois", () => {
    expect(drawer).not.toContain(".localeCompare(");
    expect(["Élodie", "eric", "Ange", "Zoé"].sort(nameCollator.compare)).toEqual(["Ange", "Élodie", "eric", "Zoé"]);
  });
});
