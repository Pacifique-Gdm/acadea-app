import { describe, expect, it } from "vitest";
import { executeTeacherGrading } from "./teacherGrading.js";

const operationId = "0d07b52b-e983-4966-88dc-95a50661796d";
const gradeId = "s__y__c__m__student__period_1";
const body = { action: "sync-offline-grade", operationId, schoolId: "s", schoolYearId: "y", assignmentId: "assignment",
  classId: "c", subjectId: "m", studentId: "student", gradingSlot: "period_1", status: "graded", score: 12,
  maximumAtCapture: 20, expectedMaximumVersion: "1:4", expectedGradeVersion: null };
const caller = { uid: "teacher-user", role: "teacher", schoolId: "s" };

function fixture() {
  const rows = new Map<string, Record<string, unknown>>([
    ["users/teacher-user", { role: "teacher", schoolId: "s", active: true }],
    ["teachers/teacher", { id: "teacher", schoolId: "s", schoolYearId: "y", userId: "teacher-user", status: "active" }],
    ["schools/s", { status: "active", activeSchoolYearId: "y" }],
    ["schoolYears/y", { schoolId: "s", status: "active" }],
    ["pedagogicalAssignments/assignment", { id: "assignment", schoolId: "s", schoolYearId: "y", teacherId: "teacher", classId: "c", subjectId: "m", active: true }],
    ["classes/c", { schoolId: "s", schoolYearId: "y", name: "Classe fictive" }],
    ["students/student", { schoolId: "s", schoolYearId: "y", classId: "c", status: "ACTIVE" }],
    ["courseGradingConfigs/s__y__c__m", { schoolId: "s", schoolYearId: "y", classId: "c", subjectId: "m", maxScore: 20, _version: "1:4" }],
  ]);
  const snapshot = (path: string) => {
    const data = rows.get(path);
    const version = String(data?._version ?? "1:0").split(":").map(Number);
    return { id: path.split("/").at(-1), exists: Boolean(data), data: () => data,
      updateTime: data ? { seconds: version[0], nanoseconds: version[1] } : undefined };
  };
  const db = {
    doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    collection: (collection: string) => {
      const query = (filters: Array<[string, unknown]>) => ({
        where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]]),
        get: async () => {
          const docs = [...rows.keys()].filter((path) => path.startsWith(`${collection}/`)).filter((path) =>
            filters.every(([field, value]) => rows.get(path)?.[field] === value)).map(snapshot);
          return { docs, size: docs.length };
        },
      });
      return query([]);
    },
    runTransaction: async (callback: (transaction: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
      set: (ref: { path: string }, value: Record<string, unknown>) => void;
      create: (ref: { path: string }, value: Record<string, unknown>) => void;
    }) => Promise<unknown>) => {
      const writes: Array<{ path: string; value: Record<string, unknown>; create: boolean }> = [];
      const result = await callback({ get: async (ref) => snapshot(ref.path),
        set: (ref, value) => writes.push({ path: ref.path, value, create: false }),
        create: (ref, value) => writes.push({ path: ref.path, value, create: true }) });
      for (const write of writes) {
        if (write.create && rows.has(write.path)) throw new Error("duplicate create");
        rows.set(write.path, { ...write.value, _version: "2:0" });
      }
      return result;
    },
  };
  return { rows, db };
}

describe("cote hors connexion transactionnelle", () => {
  it("écrit une fois et renvoie le même accusé sur une répétition", async () => {
    const { db, rows } = fixture();
    await expect(executeTeacherGrading({ db, caller, body })).resolves.toMatchObject({ ok: true, idempotent: false, gradeId });
    await expect(executeTeacherGrading({ db, caller, body })).resolves.toMatchObject({ ok: true, idempotent: true, gradeId });
    expect([...rows.keys()].filter((path) => path.startsWith("gradeEntries/"))).toEqual([`gradeEntries/${gradeId}`]);
    expect([...rows.keys()].filter((path) => path.startsWith("pedagogicalActivityLogs/"))).toHaveLength(1);
  });

  it("refuse un maximum modifié, une cote modifiée ou un élève transféré", async () => {
    const scenarios = [
      (rows: Map<string, Record<string, unknown>>) => { rows.get("courseGradingConfigs/s__y__c__m")!._version = "1:5"; },
      (rows: Map<string, Record<string, unknown>>) => { rows.set(`gradeEntries/${gradeId}`, { status: "graded", score: 19, _version: "1:6" }); },
      (rows: Map<string, Record<string, unknown>>) => { rows.get("students/student")!.schoolId = "other"; },
    ];
    for (const mutate of scenarios) {
      const { db, rows } = fixture();
      mutate(rows);
      await expect(executeTeacherGrading({ db, caller, body })).rejects.toMatchObject({ status: 409, code: "offline-conflict" });
      expect([...rows.keys()].filter((path) => path.startsWith("offlineOperationReceipts/"))).toHaveLength(0);
    }
  });

  it("refuse le même identifiant avec un autre contenu", async () => {
    const { db } = fixture();
    await executeTeacherGrading({ db, caller, body });
    await expect(executeTeacherGrading({ db, caller, body: { ...body, score: 13 } }))
      .rejects.toMatchObject({ status: 409, code: "offline-conflict" });
  });
});
