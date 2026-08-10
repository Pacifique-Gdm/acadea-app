import { describe, expect, it } from "vitest";
import { activeSubclasses, operationalClasses, validateSubclassLabels } from "./schoolSubclasses";
import type { SchoolClassRecord } from "../types";
const base = (id: string, extra: Partial<SchoolClassRecord> = {}): SchoolClassRecord => ({ id, schoolId: "school-a", schoolYearId: "year-a", name: id, active: true, ...extra });
describe("sous-classes structurées", () => {
  it("autorise zéro, refuse une seule et accepte deux ou plus", () => { expect(activeSubclasses([base("parent")], "parent")).toEqual([]); expect(validateSubclassLabels(["A"])).toContain("au moins deux"); expect(validateSubclassLabels(["A", "B"])).toBe(""); expect(validateSubclassLabels(["A", "B", "C"])).toBe(""); });
  it("refuse les doublons normalisés", () => expect(validateSubclassLabels([" A ", "a"])).toContain("uniques"));
  it("expose les sous-classes comme unités opérationnelles", () => { const rows = [base("parent"), base("a", { parentClassId: "parent" }), base("b", { parentClassId: "parent" }), base("normal")]; expect(operationalClasses(rows).map((item) => item.id)).toEqual(["a", "b", "normal"]); });
  it("ne mélange pas deux classes principales", () => { const rows = [base("a", { parentClassId: "x" }), base("b", { parentClassId: "y" })]; expect(activeSubclasses(rows, "x").map((item) => item.id)).toEqual(["a"]); });
});
