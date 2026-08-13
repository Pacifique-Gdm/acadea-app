import { describe, expect, it } from "vitest";
import type { Student } from "../../types";
import { buildSecretaryStatistics, compareAcademicClasses, filterSecretaryStatisticsStudents, secretaryStatisticsScopeLabel } from "./secretaryStatistics";

const students = [
  { id: "one", schoolId: "school-1", schoolYearId: "year-1", className: "1ère Primaire", section: "primaire", sexe: "M" },
  { id: "two", schoolId: "school-1", schoolYearId: "year-1", className: "1ère Humanités", option: "Scientifique", section: "secondaire", sexe: "F" },
] as Student[];

describe("statistiques filtrées du Secrétaire", () => {
  it("filtre par section et classe précise depuis les données existantes", () => {
    expect(filterSecretaryStatisticsStudents(students, { type: "section", section: "primaire", label: "Primaire" }).map(({ id }) => id)).toEqual(["one"]);
    expect(filterSecretaryStatisticsStudents(students, { type: "class", classKey: "1ère Humanités::option::Scientifique", label: "1ère Scientifique" }).map(({ id }) => id)).toEqual(["two"]);
    expect(filterSecretaryStatisticsStudents(students, { type: "all" })).toEqual(students);
  });

  it("calcule l'écran et l'export depuis la même structure", () => {
    const statistics = buildSecretaryStatistics(students.slice(0, 1), []);
    expect(statistics.cards[0]).toEqual(["Total élèves", 1]);
    expect(statistics.byClass).toEqual({ "1ère Primaire": 1 });
  });

  it("produit les trois libellés de portée PDF", () => {
    expect(secretaryStatisticsScopeLabel({ type: "all" })).toBe("PORTÉE : STATISTIQUES GLOBALES");
    expect(secretaryStatisticsScopeLabel({ type: "section", section: "primaire", label: "Primaire" })).toBe("PORTÉE : SECTION — Primaire");
    expect(secretaryStatisticsScopeLabel({ type: "class", classKey: "class", label: "Classe A" })).toBe("PORTÉE : CLASSE — Classe A");
  });

  it("trie les sections et classes dans l'ordre pédagogique plutôt qu'alphabétique", () => {
    const unordered = [
      { section: "primaire", label: "4e Primaire" }, { section: "secondaire", label: "2e Secondaire" }, { section: "maternelle", label: "1re Maternelle" }, { section: "primaire", label: "1re Primaire" },
      { section: "maternelle", label: "3e Maternelle" }, { section: "cteb", label: "CTEB niveau 2" }, { section: "primaire", label: "2e Primaire" }, { section: "cteb", label: "CTEB niveau 1" },
    ];
    expect(unordered.sort(compareAcademicClasses).map(({ label }) => label)).toEqual(["1re Maternelle", "3e Maternelle", "1re Primaire", "2e Primaire", "4e Primaire", "CTEB niveau 1", "CTEB niveau 2", "2e Secondaire"]);
  });

  it("place 2e avant 10e, comprend les chiffres romains et conserve les inconnus après les sections reconnues", () => {
    const unordered = [
      { section: "inconnue", label: "Classe Z", originalIndex: 0 }, { section: "primaire", label: "10ème Primaire", originalIndex: 1 }, { section: "primaire", label: "IIe Primaire", originalIndex: 2 }, { section: "inconnue", label: "Classe A", originalIndex: 3 },
    ];
    expect(unordered.sort(compareAcademicClasses).map(({ label }) => label)).toEqual(["IIe Primaire", "10ème Primaire", "Classe Z", "Classe A"]);
  });

  it("prépare les colonnes des tableaux à partir des seules données filtrées", () => {
    const statistics = buildSecretaryStatistics(students, []);
    expect(statistics.classRows[0]).toMatchObject({ order: 1, section: "Primaire", className: "1ère Primaire", option: "—", count: 1, percentage: 50 });
    expect(statistics.sectionRows).toHaveLength(2);
    expect(statistics.classRows.map(({ className }) => className)).not.toContain("Donnée extérieure");
  });

  it("groupe par section, classe et option réelles sans fusionner les options", () => {
    const optionStudents = [
      { ...students[1], id: "science-one", option: "Scientifique" },
      { ...students[1], id: "science-two", option: "Scientifique" },
      { ...students[1], id: "literature", option: "Littéraire" },
      { ...students[0], id: "primary" },
    ] as Student[];
    const statistics = buildSecretaryStatistics(optionStudents, []);
    expect(statistics.classRows).toEqual([
      { order: 1, section: "Primaire", className: "1ère Primaire", option: "—", count: 1, percentage: 25 },
      { order: 2, section: "Secondaire", className: "1ère Humanités", option: "Littéraire", count: 1, percentage: 25 },
      { order: 3, section: "Secondaire", className: "1ère Humanités", option: "Scientifique", count: 2, percentage: 50 },
    ]);
  });

  it("agrège chaque section une seule fois et ne crée aucune section absente", () => {
    const sectionStudents = [
      { ...students[0], id: "primary-one" },
      { ...students[0], id: "primary-two", className: "2ème Primaire" },
      { ...students[1], id: "secondary" },
      { ...students[1], id: "secondary" },
      { ...students[1], id: "custom", section: "technique" },
    ] as Student[];
    const statistics = buildSecretaryStatistics(sectionStudents, []);
    expect(statistics.sectionRows).toEqual([
      { order: 1, section: "Primaire", count: 2, percentage: 50 },
      { order: 2, section: "Secondaire", count: 1, percentage: 25 },
      { order: 3, section: "technique", count: 1, percentage: 25 },
    ]);
    expect(statistics.sectionRows.map(({ section }) => section)).not.toContain("Maternelle");
    expect(statistics.cards[0]).toEqual(["Total élèves", 4]);
  });

  it("recalcule les pourcentages dans le seul périmètre filtré", () => {
    const filtered = filterSecretaryStatisticsStudents(students, { type: "class", classKey: "1ère Humanités::option::Scientifique", label: "1ère Scientifique" });
    const statistics = buildSecretaryStatistics(filtered, []);
    expect(statistics.classRows).toEqual([{ order: 1, section: "Secondaire", className: "1ère Humanités", option: "Scientifique", count: 1, percentage: 100 }]);
    expect(statistics.sectionRows).toEqual([{ order: 1, section: "Secondaire", count: 1, percentage: 100 }]);
  });

  it("filtre, trie et agrège 7ème puis 8ème CTEB sous CTEB malgré une ancienne section primaire", () => {
    const ambiguousStudents = [
      { ...students[0], id: "primary", className: "6ème Primaire", section: "primaire" },
      { ...students[0], id: "cteb-eight", className: "8ème CTEB", section: "primaire" },
      { ...students[0], id: "cteb-seven", className: "7ème CTEB", section: "primaire" },
    ] as Student[];
    const ctebStudents = filterSecretaryStatisticsStudents(ambiguousStudents, { type: "section", section: "cteb", label: "CTEB" });
    const primaryStudents = filterSecretaryStatisticsStudents(ambiguousStudents, { type: "section", section: "primaire", label: "Primaire" });
    expect(ctebStudents.map(({ id }) => id)).toEqual(["cteb-eight", "cteb-seven"]);
    expect(primaryStudents.map(({ id }) => id)).toEqual(["primary"]);

    const statistics = buildSecretaryStatistics(ambiguousStudents, []);
    expect(statistics.classRows.map(({ section, className }) => [section, className])).toEqual([
      ["Primaire", "6ème Primaire"],
      ["CETB", "7ème CTEB"],
      ["CETB", "8ème CTEB"],
    ]);
    expect(statistics.sectionRows).toEqual([
      { order: 1, section: "Primaire", count: 1, percentage: 33.33 },
      { order: 2, section: "CETB", count: 2, percentage: 66.67 },
    ]);
  });
});
