import { describe, expect, it } from "vitest";
import { requireActiveSchoolYear } from "./schoolYear.js";

function database(records: Record<string, Record<string, unknown>>) {
  return { doc: (path: string) => ({ get: async () => ({ exists: Boolean(records[path]), data: () => records[path] }) }) };
}

describe("requireActiveSchoolYear", () => {
  const db = database({
    "schoolYears/year-a-active": { schoolId: "school-a", status: "active" },
    "schoolYears/year-a-archived": { schoolId: "school-a", status: "archived" },
    "schoolYears/year-b-active": { schoolId: "school-b", status: "active" },
  });

  it("retourne l'année active de la même école", async () => {
    await expect(requireActiveSchoolYear(db, "school-a", "year-a-active")).resolves.toMatchObject({ schoolId: "school-a" });
  });

  it.each([
    ["inexistante", "missing", "invalid-argument"],
    ["d'une autre école", "year-b-active", "invalid-argument"],
    ["archivée", "year-a-archived", "failed-precondition"],
  ])("refuse une année %s", async (_label, schoolYearId, code) => {
    await expect(requireActiveSchoolYear(db, "school-a", schoolYearId)).rejects.toMatchObject({ code });
  });
});
