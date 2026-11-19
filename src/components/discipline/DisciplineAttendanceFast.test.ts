import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nameCollator } from "./DisciplineAttendanceDrawer";

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
  it("trie avec des comparateurs créés une seule fois", () => {
    expect(drawer).not.toContain(".localeCompare(");
    expect(["Élodie", "eric", "Ange", "Zoé"].sort(nameCollator.compare)).toEqual(["Ange", "Élodie", "eric", "Zoé"]);
  });
});
