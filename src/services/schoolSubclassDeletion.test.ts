import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The Vercel helper is intentionally implemented in JavaScript.
import { deleteSchoolSubclass } from "../../api/_lib/schoolSubclassDeletion.js";

function fixture(students: Array<{ id: string; classId?: string; subClassId?: string; schoolId?: string; schoolYearId?: string }> = [], active = true) {
  const actor = { role: "secretary", schoolId: "school-a", active: true };
  const subclass = { schoolId: "school-a", schoolYearId: "year-a", parentClassId: "parent", subClassLabel: "A", active };
  const parent = { schoolId: "school-a", schoolYearId: "year-a", name: "7ème CTEB" };
  const docs = students.map((student) => ({ id: student.id, ref: { path: `students/${student.id}` }, data: () => ({ schoolId: "school-a", schoolYearId: "year-a", className: "7ème CTEB", ...student }) }));
  const transaction = { get: vi.fn(async (ref: { path?: string; field?: string }) => {
    if (ref.path === "users/actor") return { exists: true, data: () => actor };
    if (ref.path === "classes/sub-a") return { exists: true, data: () => subclass };
    if (ref.path === "classes/parent") return { exists: true, data: () => parent };
    const filtered = docs.filter((item) => item.data()[ref.field as "classId" | "subClassId"] === "sub-a");
    return { docs: filtered, size: filtered.length };
  }), update: vi.fn() };
  const db = {
    doc: vi.fn((path: string) => ({ path, get: async () => path === "schoolYears/year-a" ? { exists: true, data: () => ({ schoolId: "school-a", status: "active" }) } : undefined })),
    collection: vi.fn(() => ({ where: (field: string) => ({ limit: () => ({ field }) }) })),
    runTransaction: vi.fn((callback: (value: unknown) => unknown) => callback(transaction)),
  };
  const input = { db, caller: { uid: "actor", role: "secretary", schoolId: "school-a" }, body: { schoolId: "school-a", schoolYearId: "year-a", subclassId: "sub-a", confirmation: "SUPPRIMER CETTE SOUS-CLASSE" } };
  return { input, transaction, db };
}

describe("suppression sûre d'une sous-classe", () => {
  it.each(["", "supprimer cette sous-classe", "SUPPRIMER CETTE SOUS-CLASSE "])("refuse la confirmation non exacte %s", async (confirmation) => {
    const { input, db } = fixture();
    await expect(deleteSchoolSubclass({ ...input, body: { ...input.body, confirmation } })).rejects.toMatchObject({ code: "invalid-confirmation" });
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
  it("désactive sans supprimer d'élève lorsqu'aucun n'est lié", async () => {
    const { input, transaction } = fixture();
    await expect(deleteSchoolSubclass(input)).resolves.toMatchObject({ updatedStudents: 0, status: "deactivated" });
    expect(transaction.update).toHaveBeenCalledTimes(1);
    expect(transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: "classes/sub-a" }), expect.objectContaining({ active: false }));
  });
  it("détache plusieurs élèves tout en préservant identité, parent et option", async () => {
    const { input, transaction } = fixture([
      { id: "student-1", classId: "parent", subClassId: "sub-a" },
      { id: "student-2", classId: "sub-a", subClassId: "sub-a" },
    ]);
    await expect(deleteSchoolSubclass(input)).resolves.toMatchObject({ updatedStudents: 2, status: "deactivated" });
    expect(transaction.update).toHaveBeenCalledTimes(3);
    const first = transaction.update.mock.calls.find(([ref]) => ref.path === "students/student-1")?.[1];
    const second = transaction.update.mock.calls.find(([ref]) => ref.path === "students/student-2")?.[1];
    expect(first).toHaveProperty("subClassId");
    expect(first).not.toHaveProperty("classId");
    expect(first).not.toHaveProperty("option");
    expect(second).toMatchObject({ classId: "parent", className: "7ème CTEB" });
    expect(transaction.update.mock.calls.some(([ref]) => ref.path === "students/student-1" && first?.deletedAt)).toBe(false);
  });
  it("refuse une référence inter-école avant toute écriture", async () => {
    const { input, transaction } = fixture([{ id: "student-1", subClassId: "sub-a", schoolId: "school-b" }]);
    await expect(deleteSchoolSubclass(input)).rejects.toMatchObject({ code: "reference-mismatch" });
    expect(transaction.update).not.toHaveBeenCalled();
  });
  it("refuse une référence d'une autre année avant toute écriture", async () => {
    const { input, transaction } = fixture([{ id: "student-1", subClassId: "sub-a", schoolYearId: "year-b" }]);
    await expect(deleteSchoolSubclass(input)).rejects.toMatchObject({ code: "reference-mismatch" });
    expect(transaction.update).not.toHaveBeenCalled();
  });
  it("refuse explicitement plus de 400 élèves sans écriture partielle", async () => {
    const students = Array.from({ length: 401 }, (_, index) => ({ id: `student-${index}`, subClassId: "sub-a" }));
    const { input, transaction } = fixture(students);
    await expect(deleteSchoolSubclass(input)).rejects.toMatchObject({ code: "too-many-students" });
    expect(transaction.update).not.toHaveBeenCalled();
  });
  it("est idempotent pour une sous-classe déjà désactivée", async () => {
    const { input, transaction } = fixture([], false);
    await expect(deleteSchoolSubclass(input)).resolves.toMatchObject({ status: "already-inactive", updatedStudents: 0 });
    expect(transaction.update).not.toHaveBeenCalled();
  });
  it("refuse un rôle ou une école différents", async () => {
    const { input, db } = fixture();
    await expect(deleteSchoolSubclass({ ...input, caller: { ...input.caller, schoolId: "school-b" } })).rejects.toMatchObject({ code: "permission-denied" });
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
