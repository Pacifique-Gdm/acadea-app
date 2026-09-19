import { describe, expect, it } from "vitest";
import { AvailabilityRequestApiError, createAvailabilityRequest, reviewAvailabilityRequest } from "./teacherAvailabilityRequests.js";

type Value = Record<string, unknown>;
function fakeDb(seed: Record<string, Value>) {
  const values = new Map(Object.entries(seed));
  const writes: Array<{ path: string; data: Value }> = [];
  const snapshot = (path: string) => ({ exists: values.has(path), data: () => values.get(path) });
  const collection = (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }), where() { return this; } });
  return { writes, collection, runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
    get: async (target: { path?: string }) => target.path ? snapshot(target.path) : { docs: [] },
    create: (target: { path: string }, data: Value) => { writes.push({ path: target.path, data }); values.set(target.path, data); },
    update: (target: { path: string }, data: Value) => { writes.push({ path: target.path, data }); values.set(target.path, { ...values.get(target.path), ...data }); },
    set: (target: { path: string }, data: Value) => { writes.push({ path: target.path, data }); values.set(target.path, data); },
  }) };
}
const base = {
  "teacherAvailabilityRequests/r": { id: "r", schoolId: "s", schoolYearId: "y", teacherId: "t", userId: "u", requestedDate: "2026-08-11", requestType: "FULL_DAY", reason: "x", status: "PENDING" },
  "schoolYears/y": { schoolId: "s", status: "active" }, "teachers/t": { schoolId: "s", schoolYearId: "y", userId: "u", status: "active" }, "users/u": { schoolId: "s", role: "teacher", status: "active", active: true }, "users/d": { schoolId: "s", role: "study_director", status: "active", active: true },
};

describe("createAvailabilityRequest", () => {
  it("notifie le Directeur actif de la même école malgré une année de profil obsolète", async () => {
    const request = { id: "new", schoolId: "s", schoolYearId: "y", teacherId: "t", userId: "u", createdBy: "u", requestedDate: "2099-08-11", requestType: "FULL_DAY", reason: "Test", status: "PENDING", createdAt: "2099-01-01T00:00:00.000Z" };
    const values = { ...base, "schoolYears/y": { ...base["schoolYears/y"], id: "y" }, "users/d": { ...base["users/d"], activeSchoolYearId: "older-year" } };
    const writes: Array<{ path: string; data: Value }> = [];
    const collection = (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
      where: () => ({ where: () => ({ collection: name }) }),
    });
    const db = {
      collection,
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        get: async (target: { path?: string; collection?: string }) => {
          if (target.collection === "users") return { docs: [
            { id: "d", data: () => values["users/d"] },
            { id: "foreign", data: () => ({ role: "study_director", schoolId: "other", active: true }) },
            { id: "inactive", data: () => ({ role: "study_director", schoolId: "s", active: false }) },
          ] };
          const path = target.path as keyof typeof values;
          return { exists: path in values, data: () => values[path] };
        },
        create: (target: { path: string }, data: Value) => writes.push({ path: target.path, data }),
        set: (target: { path: string }, data: Value) => writes.push({ path: target.path, data }),
      }),
    };
    await createAvailabilityRequest({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, request });
    expect(writes.filter((item) => item.path.startsWith("notifications/"))).toEqual([{
      path: "notifications/availability_request_new_d",
      data: expect.objectContaining({ recipientUserId: "d", schoolId: "s", schoolYearId: "y", read: false }),
    }]);
  });
});

describe("reviewAvailabilityRequest", () => {
  it("approuve, crée une seule disponibilité et ne touche jamais aux horaires", async () => { const db = fakeDb(base); const result = await reviewAvailabilityRequest({ db, caller: { uid: "d", role: "study_director", schoolId: "s" }, requestId: "r", action: "APPROVE", reviewComment: "Accord" }); expect(result.status).toBe("APPROVED"); expect(db.writes.filter(item => item.path.startsWith("teacherAvailabilities/"))).toHaveLength(1); expect(db.writes.some(item => item.path.startsWith("timetables/") || item.path.startsWith("timetableEntries/"))).toBe(false); });
  it("rejette sans créer de disponibilité et notifie l’enseignant", async () => { const db = fakeDb(base); const result = await reviewAvailabilityRequest({ db, caller: { uid: "d", role: "study_director", schoolId: "s" }, requestId: "r", action: "REJECT", reviewComment: "Impossible" }); expect(result.status).toBe("REJECTED"); expect(db.writes.filter(item => item.path.startsWith("notifications/")).map(item => item.data.recipientUserId)).toEqual(["u"]); });
  it("refuse rôle non autorisé et double traitement", async () => { await expect(reviewAvailabilityRequest({ db: fakeDb(base), caller: { uid: "x", role: "teacher", schoolId: "s" }, requestId: "r", action: "APPROVE" })).rejects.toBeInstanceOf(AvailabilityRequestApiError); await expect(reviewAvailabilityRequest({ db: fakeDb({ ...base, "teacherAvailabilityRequests/r": { ...base["teacherAvailabilityRequests/r"], status: "APPROVED" } }), caller: { uid: "d", role: "study_director", schoolId: "s" }, requestId: "r", action: "APPROVE" })).rejects.toMatchObject({ code: "failed-precondition" }); });
  it("refuse autre école et enseignant archivé", async () => { await expect(reviewAvailabilityRequest({ db: fakeDb(base), caller: { uid: "d", role: "study_director", schoolId: "other" }, requestId: "r", action: "APPROVE" })).rejects.toMatchObject({ code: "permission-denied" }); await expect(reviewAvailabilityRequest({ db: fakeDb({ ...base, "users/u": { ...base["users/u"], active: false } }), caller: { uid: "d", role: "study_director", schoolId: "s" }, requestId: "r", action: "APPROVE" })).rejects.toMatchObject({ code: "failed-precondition" }); });
});
