import { describe, expect, it } from "vitest";
import { readPublishedTimetable } from "./publishedTimetableRead.js";

// Lot R5 : horaire publié de toute l'école + horaires publiés des sections.
function fixture(extra: Array<[string, Record<string, unknown>]> = []) {
  const scope = { schoolId: "school-a", schoolYearId: "year-a" };
  const data = new Map<string, Record<string, unknown>>([
    ["users/admin-a", { role: "school_admin", schoolId: "school-a", status: "active" }],
    ["schoolYears/year-a", { schoolId: "school-a", status: "active" }],
    ["timetables/school", { ...scope, status: "PUBLISHED", activePublished: true, version: 3 }],
    ["timetableEntries/school-p", { ...scope, scheduleId: "school", dayOfWeek: "monday", periodId: "p1", classId: "p1", subjectId: "math", teacherId: "t" }],
    ["timetableEntries/school-h", { ...scope, scheduleId: "school", dayOfWeek: "monday", periodId: "p2", classId: "h1", subjectId: "math", teacherId: "t" }],
    ["schedulePeriods/p1", { ...scope, label: "P1", startTime: "08:00", endTime: "09:00" }],
    ["schedulePeriods/p2", { ...scope, label: "P2", startTime: "09:00", endTime: "10:00" }],
    ["classes/p1", { ...scope, name: "1ère Primaire", section: "Primaire" }],
    ["classes/h1", { ...scope, name: "1ère Humanité", section: "Secondaire" }],
    ["subjects/math", { ...scope, name: "Mathématiques" }],
    ["subjects/fr", { ...scope, name: "Français" }],
    ["teachers/t", { ...scope, firstName: "Ada", lastName: "L", status: "active" }],
    ...extra,
  ]);
  const db = {
    collection(name: string) {
      const filters: Array<[string, unknown]> = [];
      let count = Infinity;
      const query = {
        where(field: string, _operator: string, value: unknown) { filters.push([field, value]); return query; },
        limit(value: number) { count = value; return query; },
        async get() { return { docs: [...data.entries()].filter(([path, value]) => path.startsWith(`${name}/`) && filters.every(([field, expected]) => value[field] === expected)).slice(0, count).map(([path, value]) => ({ id: path.slice(name.length + 1), data: () => value })) }; },
        doc(id: string) { return { async get() { const value = data.get(`${name}/${id}`); return { exists: Boolean(value), data: () => value }; } }; },
      };
      return query;
    },
  };
  return readPublishedTimetable({ db, caller: { role: "school_admin", uid: "admin-a", schoolId: "school-a" }, schoolYearId: "year-a" });
}
const scope = { schoolId: "school-a", schoolYearId: "year-a" };
const rows = (result: Awaited<ReturnType<typeof fixture>>) => result!.rows.map((row: { classLabel: string; subjectLabel: string }) => `${row.classLabel}:${row.subjectLabel}`);

describe("horaire publié par section (R5)", () => {
  it("sans horaire de section : l'horaire de l'école est rendu tel quel", async () => {
    const result = await fixture();
    expect(result!.version).toBe(3);
    expect(rows(result)).toEqual(["1ère Primaire:Mathématiques", "1ère Humanité:Mathématiques"]);
  });
  it("la section qui a publié remplace ses classes ; les autres gardent l'horaire de l'école", async () => {
    const result = await fixture([
      ["timetables/prim", { ...scope, status: "PUBLISHED", activePublished: true, version: 4, sectionId: "Primaire" }],
      ["timetableEntries/prim-p", { ...scope, scheduleId: "prim", dayOfWeek: "monday", periodId: "p1", classId: "p1", subjectId: "fr", teacherId: "t" }],
    ]);
    expect(result!.version).toBe(3);
    expect(rows(result)).toEqual(["1ère Primaire:Français", "1ère Humanité:Mathématiques"]);
  });
  it("refuse deux publications actives pour la même section", async () => {
    await expect(fixture([
      ["timetables/prim", { ...scope, status: "PUBLISHED", activePublished: true, version: 4, sectionId: "Primaire" }],
      ["timetables/prim2", { ...scope, status: "PUBLISHED", activePublished: true, version: 5, sectionId: "Primaire" }],
    ])).rejects.toMatchObject({ status: 409 });
  });
});
