import { describe, expect, it } from "vitest";
import { listPedagogicalActivity } from "./pedagogicalActivity.js";

const records = [
  { id: "a", schoolId: "s", schoolYearId: "y", subjectUserId: "teacher-a", createdAt: "2026-10-01T12:00:00Z" },
  { id: "b", schoolId: "s", schoolYearId: "y", subjectUserId: "teacher-b", createdAt: "2026-10-02T12:00:00Z" },
  { id: "c", schoolId: "other", schoolYearId: "y", subjectUserId: "teacher-a", createdAt: "2026-10-03T12:00:00Z" },
];

function fakeDb(role = "teacher") {
  const filters: Array<[string, unknown]> = [];
  const query = {
    where(field: string, _op: string, value: unknown) { filters.push([field, value]); return this; },
    orderBy() { return this; },
    startAfter() { return this; },
    limit() { return this; },
    async get() {
      return { docs: records.filter((record) => filters.every(([field, value]) => record[field as keyof typeof record] === value))
        .map((record) => ({ id: record.id, data: () => record })) };
    },
  };
  return { doc: (path: string) => ({ get: async () => ({ exists: true, data: () => path.startsWith("users/") ? { role, schoolId: "s", active: true } : { schoolId: "s" } }) }), collection: () => query };
}

describe("historique pédagogique serveur", () => {
  it("limite l'enseignant à ses événements et à son établissement", async () => {
    const result = await listPedagogicalActivity({ db: fakeDb(), caller: { uid: "teacher-a", role: "teacher", schoolId: "s" }, body: { schoolId: "s", schoolYearId: "y" } });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["a"]);
  });

  it("permet au Directeur des études les activités de son école uniquement", async () => {
    const result = await listPedagogicalActivity({ db: fakeDb("study_director"), caller: { uid: "director", role: "study_director", schoolId: "s" }, body: { schoolId: "s", schoolYearId: "y" } });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["a", "b"]);
  });

  it("permet à l'Administrateur les activités pédagogiques de son école uniquement", async () => {
    const result = await listPedagogicalActivity({ db: fakeDb("school_admin"), caller: { uid: "admin", role: "school_admin", schoolId: "s" }, body: { schoolId: "s", schoolYearId: "y" } });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["a", "b"]);
  });

  it("refuse les autres écoles et les profils incohérents", async () => {
    await expect(listPedagogicalActivity({ db: fakeDb(), caller: { uid: "teacher-a", role: "teacher", schoolId: "s" }, body: { schoolId: "other", schoolYearId: "y" } })).rejects.toMatchObject({ status: 403 });
    await expect(listPedagogicalActivity({ db: fakeDb("cashier"), caller: { uid: "teacher-a", role: "teacher", schoolId: "s" }, body: { schoolId: "s", schoolYearId: "y" } })).rejects.toMatchObject({ status: 403 });
    await expect(listPedagogicalActivity({ db: fakeDb("parent"), caller: { uid: "parent", role: "parent", schoolId: "s" }, body: { schoolId: "s", schoolYearId: "y" } })).rejects.toMatchObject({ status: 403 });
  });
});
