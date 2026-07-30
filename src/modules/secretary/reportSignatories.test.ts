import { describe, expect, it } from "vitest";
import { addReportSignatory, groupReportSignatories, normalizeReportSignatories, removeReportSignatory } from "./reportSignatories";

describe("signataires structurés d'un compte rendu", () => {
  it("ajoute, ordonne et supprime des personnes indépendantes", () => {
    const first = addReportSignatory([], " Direction ", "one");
    const second = addReportSignatory(first, "Secrétariat", "two");
    expect(second).toEqual([{ id: "one", name: "Direction" }, { id: "two", name: "Secrétariat" }]);
    expect(removeReportSignatory(second, "one")).toEqual([{ id: "two", name: "Secrétariat" }]);
  });

  it("refuse les noms vides et les doublons exacts", () => {
    const initial = [{ id: "one", name: "Direction" }];
    expect(addReportSignatory(initial, "   ", "two")).toBe(initial);
    expect(addReportSignatory(initial, "Direction", "two")).toBe(initial);
  });

  it("lit la nouvelle structure et les anciennes chaînes sans migration", () => {
    expect(normalizeReportSignatories([{ id: "one", name: "Direction" }])).toEqual([{ id: "one", name: "Direction" }]);
    expect(normalizeReportSignatories(undefined, "Direction\nSecrétariat")).toEqual([{ id: "legacy-0", name: "Direction" }, { id: "legacy-1", name: "Secrétariat" }]);
    expect(normalizeReportSignatories(undefined, undefined)).toEqual([]);
  });

  it("répartit les signataires par lignes de trois en conservant l'ordre", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({ id: `${index}`, name: `Signataire ${index + 1}` }));
    expect(groupReportSignatories(items).map((row) => row.map(({ name }) => name))).toEqual([
      ["Signataire 1", "Signataire 2", "Signataire 3"],
      ["Signataire 4", "Signataire 5", "Signataire 6"],
      ["Signataire 7"],
    ]);
  });
});
