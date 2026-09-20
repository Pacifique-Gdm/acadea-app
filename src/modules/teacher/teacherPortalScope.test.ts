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

  it("hérite la section du parent pour toutes les options opérationnelles legacy", () => {
    const optionNames = ["2ème Sciences", "3ème Littéraire", "4ème Pédagogie générale", "4ème Commerciale"];
    const legacyData = {
      ...data,
      assignments: optionNames.map((_, index) => ({ id: `a-${index}`, classId: `secondary-option-${index}`, subjectId: `subject-${index}`, active: true, weeklyPeriods: 2 })),
      classes: [
        { id: "secondary-parent", name: "3ème Humanité", section: "Secondaire" },
        ...optionNames.map((name, index) => ({ id: `secondary-option-${index}`, name, parentClassId: "secondary-parent", classOptionKey: `secondary-parent::option-${index}` })),
        { id: "modern-secondary", name: "Classe moderne", section: "Secondaire" },
        { id: "primary", name: "4ème Primaire", section: "Primaire" },
        { id: "cteb", name: "7ème CTEB", section: "CTEB" },
        { id: "preschool", name: "3ème Maternelle", section: "Maternelle" },
      ],
      subjects: optionNames.map((_, index) => ({ id: `subject-${index}` })),
      entries: optionNames.map((_, index) => ({ id: `entry-${index}`, classId: `secondary-option-${index}`, assignmentId: `a-${index}` })),
    } as unknown as TeacherPortalData;

    const scoped = scopeTeacherPortalData(user(["Secondaire"]), legacyData);
    expect(scoped.assignments.map(({ id }) => id)).toEqual(["a-0", "a-1", "a-2", "a-3"]);
    expect(scoped.subjects).toHaveLength(4);
    expect(scoped.entries).toHaveLength(4);
    expect(scoped.classes.map(({ id }) => id)).toEqual([
      "secondary-parent",
      "secondary-option-0",
      "secondary-option-1",
      "secondary-option-2",
      "secondary-option-3",
      "modern-secondary",
    ]);
  });

  it("reproduit les options Production sans métadonnées modernes et conserve toutes les affectations", () => {
    const parentId = "school__year__3eme-humanite";
    const optionNames = ["Commerciale et Gestion", "Littéraire", "Pédagogie générale", "Sciences"];
    const legacyData = {
      ...data,
      assignments: optionNames.map((name) => ({
        id: `assignment-${name}`,
        classId: `${parentId}::${name.toLocaleLowerCase().replaceAll(" ", "-")}`,
        subjectId: "english",
        active: true,
        weeklyPeriods: 2,
      })),
      classes: [
        { id: parentId, name: "3ème" },
        ...optionNames.map((name) => ({
          id: `${parentId}::${name.toLocaleLowerCase().replaceAll(" ", "-")}`,
          name: `3ème ${name}`,
        })),
        { id: "cteb-7", name: "7ème CTEB" },
      ],
      subjects: [{ id: "english" }],
      entries: [],
    } as unknown as TeacherPortalData;

    const scoped = scopeTeacherPortalData(user(["Secondaire"]), legacyData);
    expect(scoped.assignments).toHaveLength(4);
    expect(scoped.assignments.reduce((total, item) => total + item.weeklyPeriods, 0)).toBe(8);
    expect(scopeTeacherPortalData(user(["CTEB"]), legacyData).classes.map(({ id }) => id)).toEqual(["cteb-7"]);
  });
});
