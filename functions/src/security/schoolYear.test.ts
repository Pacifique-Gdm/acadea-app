import { describe, expect, it } from "vitest";
import { assertActiveSchoolYear, type SchoolYearDatabase } from "./schoolYear.js";

function database(records: Record<string, Record<string, unknown>>): SchoolYearDatabase {
  return { doc: (path) => ({ get: async () => ({ exists: Boolean(records[path]), data: () => records[path] }) }) };
}

describe("assertActiveSchoolYear", () => {
  const db = database({
    "schoolYears/year-a-active": { schoolId: "school-a", status: "active" },
    "schoolYears/year-a-archived": { schoolId: "school-a", status: "archived" },
    "schoolYears/year-b-active": { schoolId: "school-b", status: "active" },
  });

  it("accepte l'année active de l'école", async () => {
    await expect(assertActiveSchoolYear(db, "school-a", "year-a-active")).resolves.toMatchObject({ id: "year-a-active" });
  });

  it.each([
    ["absente", undefined, "invalid-argument"],
    ["inexistante", "missing", "invalid-argument"],
    ["d'une autre école", "year-b-active", "invalid-argument"],
    ["archivée", "year-a-archived", "failed-precondition"],
  ])("refuse une année %s", async (_label, schoolYearId, code) => {
    await expect(assertActiveSchoolYear(db, "school-a", schoolYearId)).rejects.toMatchObject({ code });
  });
});
