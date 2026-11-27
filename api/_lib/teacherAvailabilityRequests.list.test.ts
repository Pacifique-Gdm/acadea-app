import { describe, expect, it } from "vitest";
import { listAvailabilityRequests } from "./teacherAvailabilityRequests.js";

// Lot B : la liste des demandes d'indisponibilité est filtrée par le SERVEUR (règle unique des sections).
type Value = Record<string, unknown>;

function fakeDb(seed: Record<string, Value>) {
  const values = new Map(Object.entries(seed));
  const query = (name: string, filters: Array<[string, unknown]> = []): Record<string, unknown> => ({
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
    get: async () => ({ docs: [...values.entries()]
      .filter(([path, data]) => path.startsWith(`${name}/`) && filters.every(([field, value]) => data[field] === value))
      .map(([path, data]) => ({ id: path.split("/")[1], data: () => data })) }),
  });
  return {
    collection: (name: string) => ({ ...query(name), doc: (id: string) => ({ get: async () => ({ exists: values.has(`${name}/${id}`), data: () => values.get(`${name}/${id}`) }) }) }),
  };
}

const request = (id: string, teacherId: string, userId: string, createdAt: string) => ({ id, schoolId: "s", schoolYearId: "y", teacherId, userId, status: "PENDING", createdAt });
const base: Record<string, Value> = {
  "schools/s": { schoolType: "Mixte" },
  "schoolYears/y": { id: "y", schoolId: "s", status: "active" },
  "users/d": { schoolId: "s", role: "study_director", status: "active", active: true, sectionIds: ["Primaire"] },
  // Enseignant du Primaire (section sur son COMPTE, fiche différente).
  "teachers/tp": { schoolId: "s", schoolYearId: "y", userId: "up", sectionIds: ["Secondaire"] },
  "users/up": { schoolId: "s", role: "teacher", sectionIds: ["Primaire"] },
  // Enseignant du Secondaire (section sur sa fiche seulement).
  "teachers/ts": { schoolId: "s", schoolYearId: "y", userId: "us", sectionIds: ["Secondaire"] },
  "users/us": { schoolId: "s", role: "teacher" },
  // Enseignant sans section.
  "teachers/tn": { schoolId: "s", schoolYearId: "y", userId: "un" },
  "users/un": { schoolId: "s", role: "teacher" },
  "teacherAvailabilityRequests/rp": request("rp", "tp", "up", "2026-01-01"),
  "teacherAvailabilityRequests/rs": request("rs", "ts", "us", "2026-01-03"),
  "teacherAvailabilityRequests/rn": request("rn", "tn", "un", "2026-01-02"),
  "teacherAvailabilityRequests/autre": { ...request("autre", "tp", "up", "2026-01-04"), schoolId: "s2" },
};
const caller = { uid: "d", role: "study_director", schoolId: "s" };
const ids = async (seed: Record<string, Value>) => (await listAvailabilityRequests({ db: fakeDb(seed), caller, schoolYearId: "y" })).map((item: { id: string }) => item.id);

describe("Lot B — liste des demandes filtrée par le serveur", () => {
  it("compte d'une partie des sections : ses enseignants (section lue sur le compte) et ceux sans section", async () => {
    expect(await ids(base)).toEqual(["rn", "rp"]);
  });
  it("compte sans section : toute l'école, triée de la plus récente à la plus ancienne", async () => {
    expect(await ids({ ...base, "users/d": { ...base["users/d"], sectionIds: [] } })).toEqual(["rs", "rn", "rp"]);
  });
  it("compte couvrant toutes les sections de l'école : toute l'école", async () => {
    expect(await ids({ ...base, "schools/s": { schoolType: "CTEB et Secondaire" }, "users/d": { ...base["users/d"], sectionIds: ["CTEB", "Secondaire"] } }))
      .toEqual(["rs", "rn", "rp"]);
  });
  it("lit l'ancienne section du compte", async () => {
    expect(await ids({ ...base, "users/d": { ...base["users/d"], sectionIds: undefined, section: "Secondaire" } })).toEqual(["rs", "rn"]);
  });
  it("enseignant d'une autre section affecté à une classe de mes sections : visible", async () => {
    expect(await ids({ ...base,
      "pedagogicalAssignments/a": { schoolId: "s", schoolYearId: "y", teacherId: "ts", classId: "c", active: true },
      "classes/c": { schoolId: "s", schoolYearId: "y", section: "Primaire" } })).toEqual(["rs", "rn", "rp"]);
  });
  it("refuse un autre rôle, un compte inactif et une année d'une autre école", async () => {
    await expect(listAvailabilityRequests({ db: fakeDb(base), caller: { ...caller, role: "teacher" }, schoolYearId: "y" })).rejects.toMatchObject({ status: 403 });
    await expect(listAvailabilityRequests({ db: fakeDb({ ...base, "users/d": { ...base["users/d"], status: "inactive" } }), caller, schoolYearId: "y" })).rejects.toMatchObject({ status: 403 });
    await expect(listAvailabilityRequests({ db: fakeDb({ ...base, "schoolYears/y": { schoolId: "s2" } }), caller, schoolYearId: "y" })).rejects.toMatchObject({ status: 403 });
    await expect(listAvailabilityRequests({ db: fakeDb(base), caller, schoolYearId: "" })).rejects.toMatchObject({ status: 400 });
  });
});
