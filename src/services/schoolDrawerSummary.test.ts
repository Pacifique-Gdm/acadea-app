import { describe, expect, it } from "vitest";
import { appendSchoolHistoryPage, parseSchoolDrawerSummary, parseSchoolHistoryPage } from "./schoolDrawerSummary";

describe("lot SA-4 : réponse du serveur pour le drawer d'école", () => {
  it("accepte des nombres complets et refuse toute réponse incomplète (jamais un chiffre faux)", () => {
    const summary = { students: 3, parents: 2, admins: 1, users: 4, classes: [{ className: "1ère Primaire", option: "", count: 3 }] };
    expect(parseSchoolDrawerSummary(summary)).toEqual(summary);
    for (const broken of [null, { ...summary, students: -1 }, { ...summary, parents: "2" }, { ...summary, classes: undefined }, { ...summary, classes: [{ className: "x", count: 1 }] }]) {
      expect(() => parseSchoolDrawerSummary(broken)).toThrow("Données de l'école incomplètes.");
    }
  });

  it("vérifie chaque page d'historique et ajoute la suivante sans doublon, avec le repère de la page d'après", () => {
    const first = parseSchoolHistoryPage({ logs: [{ id: "a", action: "A", actorName: "SA", createdAt: "2026-11-21T10:00:00.000Z" }], hasMore: true, cursor: "i:abc", mode: "index" });
    const next = parseSchoolHistoryPage({ logs: [{ id: "a", action: "A", actorName: "SA", createdAt: "x" }, { id: "b", action: "B", actorName: "SA", createdAt: "y" }], hasMore: false, cursor: null });
    expect(first.cursor).toBe("i:abc");
    expect(appendSchoolHistoryPage(first, next)).toMatchObject({ hasMore: false, cursor: null, logs: [{ id: "a" }, { id: "b" }] });
    expect(() => parseSchoolHistoryPage({ logs: [{ id: 1 }], hasMore: false, cursor: null })).toThrow();
    expect(() => parseSchoolHistoryPage({ logs: [], hasMore: true, cursor: null })).toThrow(); // « Voir plus » sans repère
    expect(() => parseSchoolHistoryPage({ logs: [], hasMore: false })).toThrow();
  });
});
