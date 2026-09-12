import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../../types";
import type { StudyClass } from "./studyTypes";

const mocks = vi.hoisted(() => {
  const set = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  const get = vi.fn();
  return {
    set,
    update,
    remove,
    get,
    doc: vi.fn((_db: unknown, ...parts: string[]) => parts.join("/")),
    runTransaction: vi.fn(async (_db: unknown, callback: (transaction: { get: typeof get; set: typeof set; update: typeof update; delete: typeof remove }) => unknown) => callback({ get, set, update, delete: remove })),
  };
});

vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => ({ collection: vi.fn(), query: vi.fn(), where: vi.fn(), onSnapshot: vi.fn(), setDoc: vi.fn(), ...mocks }));

import { savePedagogicalAssignments } from "./studyService";

const user: AppUser = { id: "director", name: "Direction", email: "direction@test", role: "study_director", schoolId: "s" };
const base: StudyClass = { id: "s__y__3eme-humanite", schoolId: "s", schoolYearId: "y", name: "3ème Humanité", section: "Secondaire" };
const options: StudyClass[] = ["scientifique", "commerciale", "litteraire"].map((option) => ({
  ...base,
  id: `${base.id}::${option}`,
  name: `3ème ${option}`,
  parentClassId: base.id,
  classOptionKey: `${base.id}::${option}`,
  option,
}));

describe("persistance des affectations par groupes d'options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async (path: string) => {
      const missing = path.startsWith("pedagogicalAssignmentLocks/") || path.startsWith("classTitulars/");
      return { exists: () => !missing, data: () => missing ? undefined : { schoolId: "s", schoolYearId: "y", status: "active" } };
    });
  });

  it("écrit une affectation et un verrou canoniques sans multiplier weeklyPeriods", async () => {
    await savePedagogicalAssignments({
      user, schoolId: "s", schoolYearId: "y", teacherId: "teacher", subjectIds: ["fr"], classIds: [base.id],
      classSelections: [{ classId: base.id, courseScope: "common", targetOptionIds: [options[0].id, options[1].id] }],
      knownClasses: [base, ...options], legacyClasses: [base], weeklyPeriods: 4, titularClassIds: [base.id], existingTitulars: [], active: true,
    });
    const assignmentCall = mocks.set.mock.calls.find(([path]) => String(path).startsWith("pedagogicalAssignments/"));
    expect(assignmentCall?.[1]).toMatchObject({ courseScope: "common", targetOptionIds: [options[1].id, options[0].id].sort(), weeklyPeriods: 4 });
    expect(mocks.set.mock.calls.filter(([path]) => String(path).startsWith("pedagogicalAssignments/"))).toHaveLength(1);
    const titularCall = mocks.set.mock.calls.find(([path]) => String(path).startsWith("classTitulars/"));
    expect(titularCall?.[1].assignmentId).toBe(assignmentCall?.[1].id);
  });
});
