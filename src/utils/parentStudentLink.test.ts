import { describe, expect, it } from "vitest";
import type { AppData, AppUser, ParentProfile, Student } from "../types";
import { applyParentUnlinkResult, isExactParentUnlinkConfirmation, PARENT_UNLINK_CONFIRMATION } from "./parentStudentLink";

const studentA = { id: "student-a", parentId: "parent-a" } as Student;
const studentB = { id: "student-b", parentId: "parent-a" } as Student;
const parentA = { id: "parent-a", studentIds: ["student-a", "student-b"] } as ParentProfile;
const parentUser = { id: "parent-user-a", role: "parent", parentId: "parent-a", studentIds: ["student-a", "student-b"] } as AppUser;

describe("liaison Parent ↔ Élève", () => {
  it("exige une correspondance strictement exacte sans trim ni changement de casse", () => {
    expect(isExactParentUnlinkConfirmation(PARENT_UNLINK_CONFIRMATION)).toBe(true);
    for (const value of ["delier le parent", "DÉLIER PARENT", "DÉLIER LE parent", "DÉLIER LE PARENT ", " DELIER LE PARENT"]) {
      expect(isExactParentUnlinkConfirmation(value)).toBe(false);
    }
  });

  it("retire uniquement l'élève ciblé et conserve le parent, son compte et ses autres enfants", () => {
    const result = applyParentUnlinkResult({
      students: [studentA, studentB],
      parents: [parentA],
      users: [parentUser],
    }, { studentId: "student-a", parentId: "parent-a", parentStudentIds: ["student-b"] });

    expect(result.students.find((student) => student.id === "student-a")?.parentId).toBeUndefined();
    expect(result.students.find((student) => student.id === "student-b")?.parentId).toBe("parent-a");
    expect(result.parents).toHaveLength(1);
    expect(result.parents[0].studentIds).toEqual(["student-b"]);
    expect(result.users).toHaveLength(1);
    expect(result.users[0].studentIds).toEqual(["student-b"]);
  });

  it("conserve le parent et son compte lorsque son dernier enfant est délié", () => {
    const result = applyParentUnlinkResult({
      students: [studentA],
      parents: [{ ...parentA, studentIds: ["student-a"] }],
      users: [{ ...parentUser, studentIds: ["student-a"] }],
    } satisfies Pick<AppData, "students" | "parents" | "users">, { studentId: "student-a", parentId: "parent-a", parentStudentIds: [] });

    expect(result.parents).toHaveLength(1);
    expect(result.parents[0].studentIds).toEqual([]);
    expect(result.users).toHaveLength(1);
    expect(result.users[0].studentIds).toEqual([]);
  });
});
