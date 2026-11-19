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
  it("trie avec des comparateurs créés une seule fois", () => {
    expect(drawer).not.toContain(".localeCompare(");
    expect(["Élodie", "eric", "Ange", "Zoé"].sort(nameCollator.compare)).toEqual(["Ange", "Élodie", "eric", "Zoé"]);
  });
});
