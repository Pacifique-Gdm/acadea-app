import { describe, expect, it } from "vitest";
import type { AppUser } from "../../types";
import { scopeTeacherPortalData, type TeacherPortalData } from "./teacherPortalData";

const data = {
  assignments: [
    { id: "a-p", classId: "c-p", subjectId: "s-p", active: true },
    { id: "a-s", classId: "c-s", subjectId: "s-s", active: true },
    { id: "a-c", classId: "c-c", subjectId: "s-c", active: true },
  ],
  classes: [
    { id: "c-p", name: "1ère Primaire", section: "Primaire" },
    { id: "c-s", name: "1ère Humanité", section: "Secondaire" },
    { id: "c-c", name: "7ème CTEB", section: "CETB" },
  ],
  subjects: [{ id: "s-p" }, { id: "s-s" }, { id: "s-c" }],
  entries: [
    { id: "e-p", classId: "c-p", assignmentId: "a-p" },
    { id: "e-s", classId: "c-s", assignmentId: "a-s" },
    { id: "e-c", classId: "c-c", assignmentId: "a-c" },
  ],
  rooms: [], periods: [], loading: false, error: "",
} as unknown as TeacherPortalData;

const user = (sectionIds: AppUser["sectionIds"]) => ({ sectionIds });

describe("périmètre temps réel Enseignant", () => {
  it("recalcule ajout et retrait de sections sur les mêmes snapshots métier", () => {
    expect(scopeTeacherPortalData(user(["Primaire"]), data).classes.map(({ id }) => id)).toEqual(["c-p"]);
    expect(scopeTeacherPortalData(user(["Primaire", "Secondaire"]), data).classes.map(({ id }) => id)).toEqual(["c-p", "c-s"]);
    const secondary = scopeTeacherPortalData(user(["Secondaire"]), data);
    expect(secondary.classes.map(({ id }) => id)).toEqual(["c-s"]);
    expect(secondary.assignments.map(({ id }) => id)).toEqual(["a-s"]);
    expect(secondary.subjects.map(({ id }) => id)).toEqual(["s-s"]);
    expect(secondary.entries.map(({ id }) => id)).toEqual(["e-s"]);
  });

  it("normalise CETB en CTEB en lecture", () => {
    expect(scopeTeacherPortalData(user(["CTEB"]), data).classes.map(({ id }) => id)).toEqual(["c-c"]);
  });

  it("conserve une affectation d’une ancienne classe Scientifique sans section", () => {
    const legacyData = {
      ...data,
      assignments: [{ id: "a-legacy", classId: "c-legacy", subjectId: "s-s", active: true }],
      classes: [{ id: "c-legacy", name: "1ère Scientifique" }],
      subjects: [{ id: "s-s" }],
      entries: [],
    } as unknown as TeacherPortalData;
    expect(scopeTeacherPortalData(user(["Secondaire"]), legacyData).assignments.map(({ id }) => id)).toEqual(["a-legacy"]);
  });
});
