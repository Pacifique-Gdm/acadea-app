import { describe, expect, it } from "vitest";
import type { SecretaryReport, SecretaryReportType } from "./secretaryTypes";
import { filterSecretaryReports, matchesReportSearch, normalizeSecretarySearch } from "./secretaryListFilters";

const labels: Record<SecretaryReportType, string> = { meeting_minutes: "Compte rendu", activity_report: "Rapport d'activités", incident_report: "Rapport d'incident", official_minutes: "Procès-verbal", administrative_note: "Note administrative", other: "Autre rapport officiel" };
const report: SecretaryReport = { id: "r1", reportNumber: "RAP-001", type: "meeting_minutes", title: "Réunion pédagogique", documentDate: "2026-08-06", startTime: "08:00", endTime: "09:00", structuredContent: { lieu: "Salle Polyvalente", participants: "Direction et enseignants", "points abordés": "Résultats trimestriels", décisions: "Suivi hebdomadaire", recommandations: "Accompagnement renforcé" }, signatories: [{ id: "s1", name: "Directeur Test", functionTitle: "Directeur" }], status: "draft", authorId: "u1", authorName: "Secrétaire École", schoolId: "school-1", schoolYearId: "year-1", createdAt: "2026-08-06", updatedAt: "2026-08-06" };

describe("recherche globale des rapports", () => {
  it.each(["rap-001", "COMPTE RENDU", "2026-08-06", "reunion pedagogique", "salle polyvalente", "enseignants", "resultats", "hebdomadaire", "secretaire ecole", "directeur test"])("retrouve %s sans sensibilité aux accents ni à la casse", (query) => {
    expect(matchesReportSearch(report, query, labels[report.type])).toBe(true);
  });

  it("combine recherche et type sans erreur sur les champs absents", () => {
    const legacy = { ...report, id: "r2", type: "incident_report" as const, structuredContent: {} };
    expect(filterSecretaryReports([report, legacy], "enseignants", "meeting_minutes", labels)).toEqual([report]);
    expect(filterSecretaryReports([legacy], "valeur absente", "all", labels)).toEqual([]);
  });

  it("normalise les accents et les espaces", () => {
    expect(normalizeSecretarySearch("  RÉUNION   Pédagogique ")).toBe("reunion pedagogique");
  });
});
