import { describe, expect, it } from "vitest";
import { createAvailabilityRequest, reviewAvailabilityRequest } from "./teacherAvailabilityRequests.js";
import { profileSections, teacherInSections } from "./studySectionScope.js";

// Lot R2 : demandes d'indisponibilité limitées aux sections du compte Direction des études.
type Value = Record<string, unknown>;
type Target = { path?: string; collection?: string; filters?: Array<[string, unknown]> };

function fakeDb(seed: Record<string, Value>) {
  const values = new Map(Object.entries(seed));
  const writes: Array<{ path: string; data: Value }> = [];
  const query = (name: string, filters: Array<[string, unknown]> = []): Target & { where: (field: string, op: string, value: unknown) => unknown } => ({
    collection: name, filters, where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
  });
  const collection = (name: string) => ({ ...query(name), doc: (id: string) => ({ path: `${name}/${id}` }) });
  const read = (target: Target) => {
    if (target.path) return { exists: values.has(target.path), data: () => values.get(target.path as string) };
    const docs = [...values.entries()].filter(([path, data]) => path.startsWith(`${target.collection}/`)
      && (target.filters ?? []).every(([field, value]) => data[field] === value))
      .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }));
    return { docs };
  };
  return { writes, collection, runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
    get: async (target: Target) => read(target),
    create: (target: { path: string }, data: Value) => { writes.push({ path: target.path, data }); values.set(target.path, data); },
    update: (target: { path: string }, data: Value) => { writes.push({ path: target.path, data }); values.set(target.path, { ...values.get(target.path), ...data }); },
    set: (target: { path: string }, data: Value) => { writes.push({ path: target.path, data }); values.set(target.path, data); },
  }) };
}

const base: Record<string, Value> = {
  "teacherAvailabilityRequests/r": { id: "r", schoolId: "s", schoolYearId: "y", teacherId: "t", userId: "u", requestedDate: "2026-08-11", requestType: "FULL_DAY", reason: "x", status: "PENDING" },
  "schoolYears/y": { id: "y", schoolId: "s", status: "active" },
  "teachers/t": { schoolId: "s", schoolYearId: "y", userId: "u", status: "active", sectionIds: ["Primaire"] },
  "users/u": { schoolId: "s", role: "teacher", status: "active", active: true, name: "Enseignant A" },
  "users/d": { schoolId: "s", role: "study_director", status: "active", active: true, sectionIds: ["Primaire"] },
};
const director = { uid: "d", role: "study_director", schoolId: "s" };
const review = (seed: Record<string, Value>, action: "APPROVE" | "REJECT" = "REJECT") =>
  reviewAvailabilityRequest({ db: fakeDb(seed), caller: director, requestId: "r", action, reviewComment: "Motif" });

describe("R2 — règle « enseignant de mes sections »", () => {
  it("lit sectionIds, sinon l'ancienne section", () => {
    expect(profileSections({ sectionIds: ["Primaire", "Primaire"] })).toEqual(["Primaire"]);
    expect(profileSections({ section: "Maternelle" })).toEqual(["Maternelle"]);
    expect(profileSections({})).toEqual([]);
  });
  it("compte sans section : tout ; enseignant sans section : visible ; sinon section ou affectation", () => {
    expect(teacherInSections({ sections: [], teacherId: "t", teacher: { sectionIds: ["Secondaire"] } })).toBe(true);
    expect(teacherInSections({ sections: ["Primaire"], teacherId: "t", teacher: {} })).toBe(true);
    expect(teacherInSections({ sections: ["Primaire"], teacherId: "t", teacher: { section: "Primaire" } })).toBe(true);
    expect(teacherInSections({ sections: ["Primaire"], teacherId: "t", teacher: { sectionIds: ["Secondaire"] } })).toBe(false);
    expect(teacherInSections({ sections: ["Primaire"], teacherId: "t", teacher: { sectionIds: ["Secondaire"] },
      assignments: [{ teacherId: "t", classId: "c", active: true }], classSectionById: new Map([["c", "Primaire"]]) })).toBe(true);
    expect(teacherInSections({ sections: ["Primaire"], teacherId: "t", teacher: { sectionIds: ["Secondaire"] },
      assignments: [{ teacherId: "t", classId: "c", active: false }], classSectionById: new Map([["c", "Primaire"]]) })).toBe(false);
  });
});

describe("R2 — décision sur une demande", () => {
  it("accepte un enseignant de la même section", async () => {
    await expect(review(base)).resolves.toMatchObject({ status: "REJECTED" });
  });
  it("refuse un enseignant d'une autre section, sans rien écrire", async () => {
    const db = fakeDb({ ...base, "teachers/t": { ...base["teachers/t"], sectionIds: ["Secondaire"] } });
    await expect(reviewAvailabilityRequest({ db, caller: director, requestId: "r", action: "APPROVE" }))
      .rejects.toMatchObject({ status: 403, code: "permission-denied", message: "Cette demande concerne un enseignant hors de vos sections." });
    expect(db.writes).toEqual([]);
  });
  it("accepte un enseignant d'une autre section affecté à une classe de mes sections", async () => {
    await expect(review({ ...base, "teachers/t": { ...base["teachers/t"], sectionIds: ["Secondaire"] },
      "pedagogicalAssignments/a": { schoolId: "s", schoolYearId: "y", teacherId: "t", classId: "c", active: true },
      "classes/c": { schoolId: "s", schoolYearId: "y", section: "Primaire" } }, "APPROVE")).resolves.toMatchObject({ status: "APPROVED" });
  });
  it("accepte un enseignant sans section", async () => {
    await expect(review({ ...base, "teachers/t": { schoolId: "s", schoolYearId: "y", userId: "u", status: "active" } })).resolves.toMatchObject({ status: "REJECTED" });
  });
  it("compte sans section : traite toute l'école, comme avant", async () => {
    await expect(review({ ...base, "users/d": { ...base["users/d"], sectionIds: [] }, "teachers/t": { ...base["teachers/t"], sectionIds: ["Secondaire"] } }))
      .resolves.toMatchObject({ status: "REJECTED" });
  });
  it("lit l'ancienne section du compte", async () => {
    await expect(review({ ...base, "users/d": { ...base["users/d"], sectionIds: undefined, section: "Maternelle" } })).rejects.toMatchObject({ status: 403 });
  });
});

describe("R2 — prévenir à la création", () => {
  const request = { id: "new", schoolId: "s", schoolYearId: "y", teacherId: "t", userId: "u", createdBy: "u", requestedDate: "2099-08-11", requestType: "FULL_DAY", reason: "Test", status: "PENDING", createdAt: "2099-01-01T00:00:00.000Z" };
  const recipients = async (seed: Record<string, Value>) => {
    const db = fakeDb(seed);
    await createAvailabilityRequest({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, request });
    return db.writes.filter((item) => item.path.startsWith("notifications/")).map((item) => item.data.recipientUserId).sort();
  };
  it("prévient les comptes de la section de l'enseignant et les comptes sans section, pas les autres", async () => {
    expect(await recipients({ ...base,
      "users/other": { schoolId: "s", role: "study_director", active: true, sectionIds: ["Secondaire"] },
      "users/all": { schoolId: "s", role: "study_director", active: true } })).toEqual(["all", "d"]);
  });
  it("si aucun compte ne couvre l'enseignant, tous sont prévenus comme avant", async () => {
    expect(await recipients({ ...base, "teachers/t": { ...base["teachers/t"], sectionIds: ["Maternelle"] },
      "users/other": { schoolId: "s", role: "study_director", active: true, sectionIds: ["Secondaire"] } })).toEqual(["d", "other"]);
  });
});
