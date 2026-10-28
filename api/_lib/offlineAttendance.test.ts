import { describe, expect, it } from "vitest";
import { syncOfflineAttendance } from "./offlineAttendance.js";

const body = { operationId: "7e791e6d-cf08-43b9-8dc4-3ca61f3e54ff", schoolId: "school-a", schoolYearId: "year-a",
  studentId: "student-a", attendanceDate: "2026-10-28", status: "absent", manualReason: "Contrôle fictif",
  expectedAttendanceVersion: null };
const caller = { uid: "director-a", role: "discipline_director", schoolId: "school-a" };

function fixture() {
  const rows = new Map<string, Record<string, unknown>>([
    ["users/director-a", { role: "discipline_director", schoolId: "school-a", sectionIds: ["Secondaire"], active: true }],
    ["schools/school-a", { status: "active", activeSchoolYearId: "year-a" }],
    ["schoolYears/year-a", { status: "active", schoolId: "school-a" }],
    ["students/student-a", { schoolId: "school-a", schoolYearId: "year-a", section: "Secondaire", status: "ACTIVE", parentId: "parent-a", nom: "Fictif" }],
    ["parents/parent-a", { schoolId: "school-a", studentIds: ["student-a"] }],
  ]);
  const snapshot = (path: string) => ({ exists: rows.has(path), data: () => rows.get(path),
    updateTime: rows.has(path) ? { seconds: 1, nanoseconds: 4 } : undefined });
  const db = { doc: (path: string) => ({ path }), runTransaction: async (callback: (transaction: {
    get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
    set: (ref: { path: string }, data: Record<string, unknown>) => void;
    create: (ref: { path: string }, data: Record<string, unknown>) => void;
  }) => Promise<unknown>) => {
    const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
    const result = await callback({ get: async (ref) => snapshot(ref.path),
      set: (ref, data) => writes.push({ path: ref.path, data }),
      create: (ref, data) => writes.push({ path: ref.path, data }) });
    for (const write of writes) rows.set(write.path, write.data);
    return result;
  } };
  return { db, rows };
}

describe("présence locale transactionnelle", () => {
  it("enregistre une seule présence, une notification et un accusé idempotent", async () => {
    const { db, rows } = fixture();
    await expect(syncOfflineAttendance({ db, caller, body })).resolves.toMatchObject({ ok: true, idempotent: false });
    await expect(syncOfflineAttendance({ db, caller, body })).resolves.toMatchObject({ ok: true, idempotent: true });
    expect([...rows.keys()].filter((key) => key.startsWith("attendance/"))).toHaveLength(1);
    expect([...rows.keys()].filter((key) => key.startsWith("notifications/"))).toHaveLength(1);
    expect([...rows.keys()].filter((key) => key.startsWith("auditLogs/"))).toHaveLength(1);
  });

  it("refuse une présence déjà modifiée et un élève transféré", async () => {
    for (const change of ["attendance", "student"]) {
      const { db, rows } = fixture();
      if (change === "attendance") rows.set("attendance/attendance__school-a__year-a__student-a__2026-10-28", { status: "present" });
      else rows.get("students/student-a")!.schoolId = "school-b";
      await expect(syncOfflineAttendance({ db, caller, body })).rejects.toMatchObject({ status: 409, code: "offline-conflict" });
      expect([...rows.keys()].filter((key) => key.startsWith("offlineOperationReceipts/"))).toHaveLength(0);
    }
  });

  it("refuse une section non attribuée et une autre école", async () => {
    const { db, rows } = fixture();
    rows.get("users/director-a")!.sectionIds = ["Primaire"];
    await expect(syncOfflineAttendance({ db, caller, body })).rejects.toMatchObject({ status: 403, code: "permission-denied" });
    await expect(syncOfflineAttendance({ db, caller: { ...caller, schoolId: "school-b" }, body })).rejects.toMatchObject({ status: 403, code: "permission-denied" });
  });
});
