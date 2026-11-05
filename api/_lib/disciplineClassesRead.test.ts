import { describe, expect, it } from "vitest";
import { readDisciplineClasses } from "./disciplineClassesRead.js";

function fixture() {
  const data = new Map<string, Record<string, unknown>>([
    ["users/d", { role: "discipline_director", schoolId: "s", status: "active", sectionIds: ["Primaire"] }],
    ["schools/s", { status: "active" }], ["schoolYears/y", { schoolId: "s" }],
    ["classes/base", { schoolId: "s", schoolYearId: "y", name: "1ère Primaire", privateNote: "secret" }],
    ["classes/sub", { schoolId: "s", schoolYearId: "y", name: "Groupe A", parentClassId: "base", subClassLabel: "A" }],
    ["classes/empty", { schoolId: "s", schoolYearId: "y", name: "2ème Primaire" }],
    ["classes/secondary", { schoolId: "s", schoolYearId: "y", name: "4ème Humanités", section: "Secondaire" }],
    ["classes/foreign", { schoolId: "other", schoolYearId: "y", name: "1ère Primaire" }],
    ["classes/old", { schoolId: "s", schoolYearId: "old", name: "1ère Primaire" }],
    ["classes/inactive", { schoolId: "s", schoolYearId: "y", name: "3ème Primaire", active: false }],
  ]);
  const db = {
    doc(path: string) { return { async get() { return { exists: data.has(path), data: () => data.get(path) }; } }; },
    collection(name: string) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; },
        limit() { return query; },
        async get() { return { docs: [...data].filter(([path, value]) => path.startsWith(name + "/") && filters.every(([key, val]) => value[key] === val)).map(([path, value]) => ({ id: path.split("/")[1], data: () => value })) }; },
      };
      return query;
    },
  };
  const caller = { uid: "d", role: "discipline_director", schoolId: "s" };
  return { data, db, caller };
}
describe("lecteur des classes de présence", () => {
  it("projette les classes vides et historiques et résout la section du parent sans exposer de champs privés", async () => {
    const f = fixture();
    const rows = await readDisciplineClasses({ ...f, schoolYearId: "y" });
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["base", "sub", "empty"]);
    expect(rows[1].section).toBe("Primaire");
    expect(JSON.stringify(rows)).not.toContain("secret");
  });
  it.each(["cashier", "parent", "teacher", "school_admin"])("refuse le rôle %s", async role => {
    const f = fixture(); f.caller.role = role;
    await expect(readDisciplineClasses({ ...f, schoolYearId: "y" })).rejects.toMatchObject({ code: "permission-denied" });
  });
  it.each(["account", "school", "scope", "year", "sections"])("refuse une identité non autorisée : %s", async reason => {
    const f = fixture();
    if (reason === "account") f.data.get("users/d")!.active = false;
    if (reason === "school") f.data.get("schools/s")!.status = "suspended";
    if (reason === "scope") f.data.get("users/d")!.schoolId = "other";
    if (reason === "year") f.data.get("schoolYears/y")!.schoolId = "other";
    if (reason === "sections") f.data.get("users/d")!.sectionIds = ["invalide"];
    await expect(readDisciplineClasses({ ...f, schoolYearId: "y" })).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("préserve le périmètre historique sans sections dans le seul établissement", async () => {
    const f = fixture(); delete f.data.get("users/d")!.sectionIds;
    expect((await readDisciplineClasses({ ...f, schoolYearId: "y" })).map((r: { id: string }) => r.id)).toEqual(["base", "sub", "empty", "secondary"]);
  });
});
