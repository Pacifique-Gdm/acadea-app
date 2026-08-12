import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../../types";

const mocks = vi.hoisted(() => {
  const get = vi.fn();
  const set = vi.fn();
  return {
    get,
    set,
    runTransaction: vi.fn(async (_database: unknown, callback: (transaction: { get: typeof get; set: typeof set; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }) => unknown) => callback({ get, set, update: vi.fn(), delete: vi.fn() })),
    doc: vi.fn((_database: unknown, ...parts: string[]) => parts.join("/")),
  };
});

vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => ({ collection: vi.fn(), query: vi.fn(), where: vi.fn(), onSnapshot: vi.fn(), setDoc: vi.fn(), ...mocks }));

import { savePrimaryHomeroomAssignments } from "./studyService";

const user = { id: "director", name: "Direction", email: "director@test", role: "study_director", schoolId: "school", activeSchoolYearId: "year" } as AppUser;

describe("affectation de classe principale Primaire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async (path: string) => ({ exists: () => !String(path).startsWith("classTitulars/"), data: () => ({ schoolId: "school", schoolYearId: "year", status: "active", role: "teacher" }) }));
  });

  it("matérialise et titularise la classe avant de créer séparément les autres cours", async () => {
    await savePrimaryHomeroomAssignments({ user, schoolId: "school", schoolYearId: "year", teacherId: "teacher", subjectIds: ["français", "math", "sciences"], classId: "school__year__3eme-primaire", legacyClass: { id: "school__year__3eme-primaire", name: "3ème Primaire", schoolId: "school", schoolYearId: "year" }, weeklyPeriods: 2, active: true });
    expect(mocks.runTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenCalledWith("classTitulars/school__year__school__year__3eme-primaire", expect.objectContaining({ classId: "school__year__3eme-primaire", teacherId: "teacher" }));
    expect(mocks.set.mock.calls.filter(([path]) => String(path).startsWith("pedagogicalAssignments/"))).toHaveLength(3);
  });

  it("refuse une classe legacy d'une autre école", async () => {
    await expect(savePrimaryHomeroomAssignments({ user, schoolId: "school", schoolYearId: "year", teacherId: "teacher", subjectIds: ["math"], classId: "foreign", legacyClass: { id: "foreign", name: "Classe", schoolId: "other", schoolYearId: "year" }, weeklyPeriods: 2, active: true })).rejects.toThrow("hors périmètre");
  });
});
