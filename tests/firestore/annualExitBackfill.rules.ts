import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { planAnnualExitBackfill } from "../../api/_lib/annualExitBackfill.js";

const projectId = "demo-acadea-annual-exit-backfill";
let app: App, db: Firestore;
const student = (id: string, yearId: string, changes: Record<string, unknown> = {}) => ({ id, schoolId: "school-a", schoolYearId: yearId, matricule: id, nom: "Test", postnom: "", prenom: id, sexe: "F", birthDate: "2015-01-01", className: "1ère Primaire", status: "ACTIVE", ...changes });

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Ce test exige exclusivement un Emulator Firestore local.");
  app = initializeApp({ projectId }, "annual-exit-backfill-tests"); db = getFirestore(app);
}, 30_000);
beforeEach(async () => {
  const existing = await Promise.all(["schools", "schoolYears", "students", "classes", "archivedStudentImports", "auditLogs"].map((name) => db.collection(name).get()));
  const cleanup = db.batch(); existing.flatMap((snapshot) => snapshot.docs).forEach((item) => cleanup.delete(item.ref)); await cleanup.commit();
  const batch = db.batch();
  for (const [path, value] of Object.entries({
    "schools/school-a": { id: "school-a", status: "active", activeSchoolYearId: "y3", educationLevels: ["Primaire"] },
    "schoolYears/y1": { id: "y1", schoolId: "school-a", name: "2024-2025", status: "archived" },
    "schoolYears/y2": { id: "y2", schoolId: "school-a", name: "2025-2026", status: "archived", studentsImportedFromArchivedYear: true, studentsImportedFromYearId: "y1" },
    "schoolYears/y3": { id: "y3", schoolId: "school-a", name: "2026-2027", status: "active" },
    "classes/y2-c2": { id: "y2-c2", schoolId: "school-a", schoolYearId: "y2", name: "2ème Primaire", active: true },
    "students/kept": student("kept", "y1"),
    "students/kept-new": student("kept-new", "y2", { className: "2ème Primaire", importedFromStudentId: "kept" }),
    "students/forgotten": student("forgotten", "y1", { matricule: "F-1", prenom: "Oublié" }),
    "students/sixth": student("sixth", "y1", { className: "6ème Primaire", prenom: "Sixième" }),
    "students/pending": student("pending", "y2", { className: "2ème Primaire", prenom: "Attente" }),
  })) batch.set(db.doc(path), value);
  await batch.commit();
});
afterAll(async () => { if (app) await deleteApp(app); });

describe("rattrapage lot 20 : simulation puis application", () => {
  it("la simulation n'écrit rien et donne un motif par cas", async () => {
    const plan = await planAnnualExitBackfill({ db, schoolId: "school-a" });
    expect(plan).toMatchObject({ applied: false, toArchive: 2 });
    const afterImport = plan.groups.find((group) => group.category === "after-import");
    expect(afterImport?.students).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "forgotten", exitReasonDetails: "Non réinscrit à la rentrée 2025-2026" }),
      expect.objectContaining({ id: "sixth", exitReasonDetails: "Fin de parcours dans l'école : cycle CTEB non organisé" }),
    ]));
    // L'année juste avant l'année active n'a pas encore été importée : jamais touchée.
    expect(plan.groups.find((group) => group.schoolYearId === "y2")?.category).toBe("import-pending");
    expect((await db.doc("students/forgotten").get()).data()?.status).toBe("ACTIVE");
  });

  it("l'application archive avec motif et repère, une relance ne fait plus rien", async () => {
    const applied = await planAnnualExitBackfill({ db, schoolId: "school-a", apply: true, actor: "test" });
    expect(applied).toMatchObject({ applied: true, archived: 2, conflicts: 0 });
    expect((await db.doc("students/forgotten").get()).data()).toMatchObject({ status: "TRANSFERRED", exitReason: "Autre", exitReasonDetails: "Non réinscrit à la rentrée 2025-2026", searchArchived: true, annualExit: { jobId: "backfill-lot20", backfill: true } });
    expect((await db.doc("students/kept").get()).data()?.status).toBe("ACTIVE");
    expect((await db.doc("students/pending").get()).data()?.status).toBe("ACTIVE");
    expect(await planAnnualExitBackfill({ db, schoolId: "school-a" })).toMatchObject({ toArchive: 0 });
  });
});
