import { describe, expect, it } from "vitest";
import type { OfflineContext } from "../services/offlineContext";
import { offlineEnrollmentClasses, offlineFeeChoices, sortedOfflineStudents } from "./offlineFormChoices";

const context: OfflineContext = { role: "cashier", schoolId: "s", schoolYearId: "y", savedAt: "", courses: [], existingAttendanceIds: [],
  classes: [{ id: "parent", name: "Primaire", operational: false }, { id: "child", name: "1re A", parentClassId: "parent", operational: true }, { id: "legacy", name: "Ancienne référence" }],
  students: [{ id: "p", name: "Émile", className: "1re", feeTypeIds: ["f", "f2", "usd"] }],
  fees: [{ id: "f", name: "Minerval", amount: 1000, currency: "CDF" }, { id: "f", name: "Minerval", amount: 1000, currency: "CDF" },
    { id: "f2", name: "Minerval", amount: 1000, currency: "CDF" }, { id: "usd", name: "Minerval", amount: 10, currency: "USD" },
    { id: "foreign-class", name: "Minerval", amount: 2000, currency: "CDF" }] };
describe("choix hors connexion, sans modification des références", () => {
  it("trie les accents, espaces et homonymes avec un départage stable", () => {
    const rows = ["Zola", " émile ", "Alice", "Émile"].map((name, i) => ({ id: String(i), name, className: "c" }));
    expect(sortedOfflineStudents(rows).map((row) => row.id)).toEqual(["2", "1", "3", "0"]);
    expect(rows[0].name).toBe("Zola");
  });
  it("élimine seulement les répétitions du même identifiant métier", () => {
    expect(offlineFeeChoices(context, "p").map((fee) => fee.id)).toEqual(["f", "f2", "usd"]);
    expect(context.fees).toHaveLength(5);
  });
  it("conserve deux obligations homonymes et leurs devises", () => {
    expect(offlineFeeChoices(context, "p").map((fee) => fee.currency)).toEqual(["CDF", "CDF", "USD"]);
  });
  it("ne propose aucun frais sans élève ou sans métadonnées d'attribution", () => {
    expect(offlineFeeChoices(context, "unknown")).toEqual([]);
    expect(offlineFeeChoices({ ...context, students: [{ id: "p", name: "P", className: "c" }] }, "p")).toEqual([]);
  });
  it("refuse une référence de cache ambiguë au lieu de choisir un montant", () => {
    expect(offlineFeeChoices({ ...context, fees: [...context.fees, { id: "f", name: "Minerval", amount: 99, currency: "USD" }] }, "p").map((fee) => fee.id)).toEqual(["f2", "usd"]);
  });
  it("ne propose que les classes certifiées opérationnelles par le préchargement", () => {
    expect(offlineEnrollmentClasses(context).map((row) => row.id)).toEqual(["child"]);
    expect(offlineEnrollmentClasses(null)).toEqual([]);
  });
});
