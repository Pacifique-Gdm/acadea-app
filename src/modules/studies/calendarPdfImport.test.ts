import { describe, expect, it } from "vitest";
import type { SchoolYear } from "../../types";
import { parsePdfCalendarLines } from "./calendarPdfImport";

const year = { id: "year-a", schoolId: "school-a", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-31", status: "active" } as SchoolYear;

describe("préparation prudente d'un calendrier PDF", () => {
  it("lit les lignes de plusieurs pages et conserve chaque page et niveau", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "CALENDRIER MATERNELLE" },
      { page: 1, text: "Vacances scolaires du 20/12/2026 au 05/01/2027" },
      { page: 2, text: "SECONDAIRE ET TECHNIQUE" },
      { page: 2, text: "Examens semestriels 13 janvier 2027" },
      { page: 2, text: "Total 180 jours" },
    ], year, 2);
    expect(result.candidates).toMatchObject([
      { startsAt: "2026-12-20", endsAt: "2027-01-05", kind: "vacation", educationLevel: "Maternelle", sourcePage: 1, suspendsCourses: true, reviewed: false },
      { startsAt: "2027-01-13", endsAt: "2027-01-13", kind: "exam", educationLevel: "Secondaire et Technique", sourcePage: 2, suspendsCourses: false, reviewed: false },
    ]);
  });
  it("ne crée rien à partir d'un en-tête, total ou date sans année", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "DATE EVENEMENT NIVEAU" },
      { page: 1, text: "Total 180 jours 2026-2027" },
      { page: 1, text: "Vacances du 20/12 au 05/01" },
    ], year, 1);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings).toContain("Page 1 : date sans année, ligne non importée.");
  });
  it("signale les dates numériques ambiguës et n'invente aucune année", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "Congé 10/11/2026" },
      { page: 1, text: "Réunion 10/11" },
      { page: 1, text: "Rentrée 31/02/2027" },
    ], year, 1);
    expect(result.candidates).toMatchObject([{ startsAt: "2026-11-10", uncertain: true, reviewed: false }]);
    expect(result.warnings).toHaveLength(2);
  });
  it("rejette une date hors de l'année active et ne mélange pas les niveaux", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "PRIMAIRE" },
      { page: 1, text: "Congé 15/08/2026" },
      { page: 2, text: "MATERNELLE" },
      { page: 2, text: "Réunion 15/10/2026" },
    ], year, 2);
    expect(result.candidates).toMatchObject([{ educationLevel: "Maternelle", kind: "meeting", suspendsCourses: false }]);
    expect(result.warnings).toHaveLength(1);
  });
  it("marque systématiquement incertain un événement provenant d'une OCR locale", () => {
    const result = parsePdfCalendarLines([{ page: 1, text: "MATERNELLE Vacances du 20 décembre 2026", ocr: true }], year, 1);
    expect(result.candidates).toMatchObject([{ sourcePage: 1, uncertain: true, reviewed: false, kind: "vacation" }]);
  });
  it("reconnaît le premier jour du mois écrit 1er sans créer de date implicite", () => {
    const result = parsePdfCalendarLines([{ page: 1, text: "Rentrée des classes mardi 1er septembre 2026" }], year, 1);
    expect(result.candidates).toMatchObject([{ startsAt: "2026-09-01", endsAt: "2026-09-01", kind: "resumption" }]);
  });
});
