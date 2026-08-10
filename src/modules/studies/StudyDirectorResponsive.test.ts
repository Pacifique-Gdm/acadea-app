import fs from "node:fs";
import { describe, expect, it } from "vitest";
describe("portail Direction des études responsive", () => {
  const portal = fs.readFileSync("src/modules/studies/StudyDirectorPortal.tsx", "utf8"); const schedules = fs.readFileSync("src/modules/studies/StudySchedulesModule.tsx", "utf8"); const teachers = fs.readFileSync("src/modules/studies/StudyTeachersModule.tsx", "utf8");
  it("affiche trois cartes par rangée au desktop et les drawers", () => { expect(portal).toContain("lg:grid-cols-3"); for (const label of ["Historique des versions", "Périodes & tranches horaires", "Salles"]) expect(portal).toContain(label); });
  it("retire l’historique de l’onglet et exporte le filtre courant", () => { expect(schedules).not.toContain("StudyScheduleHistory"); expect(schedules).toContain("Exporter PDF"); expect(schedules).toContain("entries: filtered"); });
  it("utilise les classes dynamiques comme titulaires", () => { expect(teachers).toContain("Titulaire de la classe (facultatif)"); expect(teachers).toContain("Choisir classe"); expect(teachers).not.toContain("Salle préférée (facultatif)"); });
});
