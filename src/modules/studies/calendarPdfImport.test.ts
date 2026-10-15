import { describe, expect, it } from "vitest";
import type { SchoolYear } from "../../types";
import { isImportablePdfCandidate, parsePdfCalendarLines } from "./calendarPdfImport";

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
      { startsAt: "2026-12-20", endsAt: "2027-01-05", kind: "vacation", educationLevel: "Maternelle", sourcePage: 1, suspendsCourses: false, status: "to-review", selected: false, reviewed: false, sourceExcerpt: "Vacances scolaires du 20/12/2026 au 05/01/2027" },
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
    expect(result.candidates).toMatchObject([{ sourcePage: 1, uncertain: true, reviewed: false, selected: false, suspendsCourses: false, kind: "vacation" }]);
  });
  it("écarte les plages OCR incomplètes et les mentions narratives de vacances", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "Enseignement maternel", ocr: true },
      { page: 1, text: "Congé de détente Du jeudi 05 au samedi 07 novembre 2026", ocr: true },
      { page: 1, text: "Vacances du 23 décembre 2026 au 09 janvier 2027", ocr: true },
      { page: 2, text: "Élèves maîtres du 22 février 2027 au 12 avril 2027, hors vacances scolaires", ocr: true },
      { page: 2, text: "Examens mardi 15 et mercredi 16 juin 2027", ocr: true },
    ], year, 2);
    expect(result.candidates).toMatchObject([
      { educationLevel: "Maternelle", kind: "vacation", startsAt: "", endsAt: "", selected: false, suspendsCourses: false, status: "to-review" },
      { educationLevel: "Maternelle", startsAt: "2026-12-23", endsAt: "2027-01-09", selected: false, suspendsCourses: false },
      { educationLevel: "Non déterminé", kind: "exam", startsAt: "", endsAt: "", selected: false, suspendsCourses: false },
    ]);
    expect(result.warnings).toContain("Page 1 : plage OCR incomplète, dates à renseigner à partir du PDF original.");
  });
  it("ne propage pas un niveau OCR d'une page à la suivante", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "SECONDAIRE ET TECHNIQUE", ocr: true },
      { page: 2, text: "Vacances du 23 décembre 2026 au 09 janvier 2027", ocr: true },
    ], year, 2);
    expect(result.candidates).toMatchObject([{ educationLevel: "Non déterminé", uncertain: true }]);
  });
  it("reconnaît le changement de cycle dans une page OCR", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "V.2 Enseignement primaire", ocr: true },
      { page: 1, text: "Examen primaire le 09 juin 2027", ocr: true },
      { page: 1, text: "V.3 Secondaire cycle court", ocr: true },
      { page: 1, text: "Épreuve du 04 mai 2027", ocr: true },
    ], year, 1);
    expect(result.candidates).toMatchObject([
      { educationLevel: "Primaire" },
      { educationLevel: "Secondaire cycle court" },
    ]);
  });
  it("reconnaît le premier jour du mois écrit 1er sans créer de date implicite", () => {
    const result = parsePdfCalendarLines([{ page: 1, text: "Rentrée des classes mardi 1er septembre 2026" }], year, 1);
    expect(result.candidates).toMatchObject([{ startsAt: "2026-09-01", endsAt: "2026-09-01", kind: "resumption" }]);
  });
  it("bloque explicitement un calendrier 2026-2027 pour une année active 2027-2028", () => {
    expect(() => parsePdfCalendarLines([
      { page: 1, text: "Calendrier scolaire 2026-2027" },
      { page: 1, text: "Vacances du 23 décembre 2026 au 09 janvier 2027", ocr: true },
    ], { ...year, name: "2027-2028", startsAt: "2027-09-01", endsAt: "2028-07-31" }, 1)).toThrow("Le PDF concerne 2026-2027");
  });
  it("n'active pas une suspension à partir d'un intitulé de vacances OCR", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "Calendrier scolaire 2026-2027", ocr: true },
      { page: 1, text: "Enseignement primaire", ocr: true },
      { page: 1, text: "Vacances du 23 décembre 2026 au 09 janvier 2027", ocr: true },
    ], year, 1);
    expect(result.documentYear).toBe("2026-2027");
    expect(result.candidates).toMatchObject([{ educationLevel: "Primaire", suspendsCourses: false, status: "to-review", selected: false, sourcePage: 1 }]);
  });
  it("écarte une date OCR dont le jour de semaine est contradictoire", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "Calendrier scolaire 2026-2027", ocr: true },
      { page: 1, text: "* Reprise des cours Lundi 06 avril 2027", ocr: true },
      { page: 1, text: "* Reprise des cours Lundi 05 avril 2027", ocr: true },
    ], year, 1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ startsAt: "2027-04-05", title: "Reprise des cours", sourceExcerpt: "* Reprise des cours Lundi 05 avril 2027" });
    expect(result.warnings).toContain("Page 1 : jour de semaine contradictoire avec la date OCR, ligne non importée.");
  });
  it("n'interprète pas un rapport de rentrée administratif comme une reprise des cours", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "Calendrier scolaire 2026-2027", ocr: true },
      { page: 1, text: "Vendredi 09 octobre 2026 : transmission des rapports de rentrée aux bureaux de proximité.", ocr: true },
    ], year, 1);
    expect(result.candidates).toHaveLength(0);
  });
  it("ignore l'année suivante mentionnée dans une ligne distincte du titre du document", () => {
    const result = parsePdfCalendarLines([
      { page: 1, text: "Calendrier scolaire 2026-2027", ocr: true },
      { page: 1, text: "Rentrée scolaire suivante (2027-2028) le 01 septembre 2027", ocr: true },
    ], year, 1);
    expect(result.documentYear).toBe("2026-2027");
  });
  it("lit les jours fériés de la rubrique légale sans les déclarer suspensifs", () => {
    const result = parsePdfCalendarLines([
      { page: 6, text: "VI. JOURS FÉRIÉS LÉGAUX", ocr: true },
      { page: 6, text: "Vendredi 25 décembre 2026 Fête de la Nativité", ocr: true },
      { page: 6, text: "Vendredi 1° janvier 2027 Fête du Nouvel An", ocr: true },
      { page: 6, text: "Mardi 06 avril 2027 Combat de Simon Kimbangu", ocr: true },
    ], year, 6);
    expect(result.candidates).toMatchObject([
      { kind: "holiday", title: "Fête de la Nativité", startsAt: "2026-12-25", educationLevel: "Tous niveaux", suspendsCourses: false },
      { kind: "holiday", title: "Fête du Nouvel An", startsAt: "2027-01-01", educationLevel: "Tous niveaux", suspendsCourses: false },
      { kind: "holiday", title: "Combat de Simon Kimbangu", startsAt: "2027-04-06", educationLevel: "Tous niveaux", suspendsCourses: false },
    ]);
  });
  it("interdit l'import des propositions à vérifier, rejetées ou incomplètes", () => {
    const candidate = parsePdfCalendarLines([{ page: 1, text: "Vacances du 23 décembre 2026 au 09 janvier 2027" }], year, 1).candidates[0];
    expect(isImportablePdfCandidate(candidate)).toBe(false);
    const selected = { ...candidate, selected: true, reviewed: true, status: "verified" as const, educationLevel: "Primaire" };
    expect(isImportablePdfCandidate(selected)).toBe(true);
    expect(isImportablePdfCandidate({ ...selected, status: "rejected" })).toBe(false);
    expect(isImportablePdfCandidate({ ...selected, startsAt: "" })).toBe(false);
    expect(isImportablePdfCandidate({ ...selected, educationLevel: "Non déterminé" })).toBe(false);
    expect(isImportablePdfCandidate({ ...selected, endsAt: "2026-12-22" })).toBe(false);
  });
});
