import { describe, expect, it } from "vitest";

// Lot B : règle unique des sections pour la présence hors ligne (copie de la préparation du test existant).
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

describe("Lot B — présence hors ligne et règle unique des sections", () => {
  it("Directeur sans section : toute l'école", async () => {
    const { db, rows } = fixture();
    delete rows.get("users/director-a")!.sectionIds;
    await expect(syncOfflineAttendance({ db, caller, body })).resolves.toMatchObject({ ok: true });
  });
  it("Directeur couvrant toutes les sections de l'école : élève d'une section hors école accepté", async () => {
    const { db, rows } = fixture();
    rows.set("schools/school-a", { status: "active", activeSchoolYearId: "year-a", schoolType: "Primaire uniquement" });
    rows.get("users/director-a")!.sectionIds = ["Primaire"];
    await expect(syncOfflineAttendance({ db, caller, body })).resolves.toMatchObject({ ok: true });
  });
  it("Directeur aux sections invalides : refusé (jamais élargi)", async () => {
    const { db, rows } = fixture();
    rows.get("users/director-a")!.sectionIds = ["Lycée"];
    await expect(syncOfflineAttendance({ db, caller, body })).rejects.toMatchObject({ status: 403, code: "permission-denied" });
  });
});
