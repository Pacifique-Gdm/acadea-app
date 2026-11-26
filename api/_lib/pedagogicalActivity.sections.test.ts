import { describe, expect, it } from "vitest";
import { listPedagogicalActivity } from "./pedagogicalActivity.js";

// Lot R2 : l'Historique pédagogique d'un compte Direction des études AVEC sections
// ne montre que l'activité des enseignants de ses sections.
type Value = Record<string, unknown>;

function fakeDb(collections: Record<string, Value[]>, director: Value) {
  const docs = (name: string) => collections[name] ?? [];
  const query = (name: string, filters: Array<[string, unknown]> = [], after?: [string, string], max = Infinity): unknown => ({
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]], after, max),
    orderBy: () => query(name, filters, after, max),
    startAfter: (createdAt: string, id: string) => query(name, filters, [createdAt, id], max),
    limit: (value: number) => query(name, filters, after, value),
    get: async () => {
      let rows = docs(name).filter((row) => filters.every(([field, value]) => row[field] === value));
      if (name === "pedagogicalActivityLogs") {
        rows = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
        if (after) rows = rows.filter((row) => String(row.createdAt) < after[0] || (row.createdAt === after[0] && String(row.id) < after[1]));
      }
      return { docs: rows.slice(0, max).map((row) => ({ id: String(row.id), data: () => row })) };
    },
  });
  return {
    collection: (name: string) => query(name),
    doc: (path: string) => ({ get: async () => ({ exists: true, data: () => path.startsWith("users/") ? director : { schoolId: "s", status: "active" } }) }),
  };
}

const scope = { schoolId: "s", schoolYearId: "y" };
const collections = {
  teachers: [
    { id: "t-prim", ...scope, userId: "u-prim", sectionIds: ["Primaire"] },
    { id: "t-sec", ...scope, userId: "u-sec", sectionIds: ["Secondaire"] },
    { id: "t-none", ...scope, userId: "u-none" },
    { id: "t-sec-affecte", ...scope, userId: "u-sec-affecte", section: "Secondaire" },
  ],
  pedagogicalAssignments: [{ id: "a", ...scope, teacherId: "t-sec-affecte", classId: "c-prim", active: true }],
  classes: [{ id: "c-prim", ...scope, section: "Primaire" }],
  pedagogicalActivityLogs: [
    { id: "1", ...scope, subjectUserId: "u-prim", createdAt: "2026-10-05" },
    { id: "2", ...scope, subjectUserId: "u-sec", createdAt: "2026-10-04" },
    { id: "3", ...scope, subjectUserId: "u-none", createdAt: "2026-10-03" },
    { id: "4", ...scope, subjectUserId: "u-sec-affecte", createdAt: "2026-10-02" },
    { id: "5", schoolId: "autre", schoolYearId: "y", subjectUserId: "u-prim", createdAt: "2026-10-01" },
  ],
};
const call = (director: Value, cursor?: { createdAt: string; id: string }) => listPedagogicalActivity({
  db: fakeDb(collections, { role: "study_director", schoolId: "s", active: true, ...director }),
  caller: { uid: "d", role: "study_director", schoolId: "s" }, body: { ...scope, ...(cursor ? { cursor } : {}) },
});

describe("R2 — Historique pédagogique par section", () => {
  it("compte avec sections : seulement les enseignants de ses sections (section, sans section, ou affecté)", async () => {
    const result = await call({ sectionIds: ["Primaire"] });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["1", "3", "4"]);
    expect(result.nextCursor).toBeNull();
  });
  it("lit l'ancienne section du compte", async () => {
    const result = await call({ section: "Secondaire" });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["2", "3", "4"]);
  });
  it("compte sans section : toute l'école, comme avant", async () => {
    const result = await call({});
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["1", "2", "3", "4"]);
  });
  it("pagine par 50 éléments visibles en sautant ceux des autres sections", async () => {
    const logs = Array.from({ length: 130 }, (_, index) => ({ id: `l${String(index).padStart(3, "0")}`, ...scope,
      subjectUserId: index % 2 ? "u-sec" : "u-prim", createdAt: `2026-11-${String(1 + (index % 28)).padStart(2, "0")}T${String(index).padStart(3, "0")}` }));
    const db = fakeDb({ ...collections, pedagogicalActivityLogs: logs }, { role: "study_director", schoolId: "s", active: true, sectionIds: ["Primaire"] });
    const first = await listPedagogicalActivity({ db, caller: { uid: "d", role: "study_director", schoolId: "s" }, body: scope });
    expect(first.items).toHaveLength(50);
    expect(first.items.every((item: { subjectUserId: string }) => item.subjectUserId === "u-prim")).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await listPedagogicalActivity({ db, caller: { uid: "d", role: "study_director", schoolId: "s" }, body: { ...scope, cursor: first.nextCursor } });
    expect(second.items).toHaveLength(15);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(65);
  });
});
