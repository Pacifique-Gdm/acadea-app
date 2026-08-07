import { describe, expect, it } from "vitest";
import {
  completeSchoolAiUsage,
  prepareSchoolAiUsage,
  releaseSchoolAiUsage,
  reserveSchoolAiUsage,
  resetSchoolAiUsage,
  type AiUsageDatabase,
} from "./schoolAiUsage.js";

class FakeUsageDatabase implements AiUsageDatabase {
  readonly documents = new Map<string, Record<string, unknown>>();
  private queue = Promise.resolve();
  constructor(school?: Record<string, unknown>, schoolId = "school-1") { if (school) this.documents.set(`schools/${schoolId}`, school); }
  doc(path: string) { return path; }
  runTransaction<T>(operation: (transaction: {
    get(reference: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    set(reference: unknown, value: Record<string, unknown>, options?: { merge: boolean }): void;
    update(reference: unknown, patch: Record<string, unknown>): void;
  }) => Promise<T>) {
    const run = this.queue.then(() => operation({
      get: async (reference) => { const data = this.documents.get(String(reference)); return { exists: Boolean(data), data: () => data ? structuredClone(data) : undefined }; },
      set: (reference, value, options) => this.documents.set(String(reference), options?.merge ? { ...(this.documents.get(String(reference)) ?? {}), ...value } : structuredClone(value)),
      update: (reference, patch) => {
        const current = structuredClone(this.documents.get(String(reference)) ?? {});
        for (const [key, value] of Object.entries(patch)) {
          if (!key.startsWith("aiAssistant.")) current[key] = value;
          else {
            const ai = current.aiAssistant && typeof current.aiAssistant === "object" ? current.aiAssistant as Record<string, unknown> : {};
            ai[key.slice("aiAssistant.".length)] = value;
            current.aiAssistant = ai;
          }
        }
        this.documents.set(String(reference), current);
      },
    }));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
  usage(schoolId = "school-1") { return (this.documents.get(`schools/${schoolId}`)?.aiAssistant as Record<string, unknown>).monthlyUsage; }
  reservation(key: string, schoolId = "school-1") { return this.documents.get(`schools/${schoolId}/aiUsageReservations/${key}`); }
}

const month = "2026-07";
const enabledSchool = (monthlyUsage = 0, monthlyLimit = 25, usageMonth = month) => ({ status: "active", aiAssistant: { enabled: true, monthlyUsage, monthlyLimit, usageMonth } });
const reservation = (db: FakeUsageDatabase, key: string, schoolId = "school-1", userId = "secretary-1") => reserveSchoolAiUsage(db, { schoolId, userId, idempotencyKey: key, currentMonth: month, now: "2026-07-01T00:00:00.000Z" });

describe("quota IA atomique", () => {
  it("reserve avant le fournisseur lorsque le quota est disponible", async () => {
    const db = new FakeUsageDatabase(enabledSchool(2));
    await expect(reservation(db, "request-1")).resolves.toMatchObject({ status: "reserved", usage: { monthlyUsage: 3 } });
    expect(db.usage()).toBe(3);
  });

  it("refuse quota atteint et Assistant desactive", async () => {
    await expect(reservation(new FakeUsageDatabase(enabledSchool(25)), "full")).rejects.toMatchObject({ code: "resource-exhausted" });
    await expect(reservation(new FakeUsageDatabase({ status: "active", aiAssistant: { enabled: false } }), "disabled")).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("n'autorise qu'une reservation concurrente sur la derniere unite", async () => {
    const db = new FakeUsageDatabase(enabledSchool(9, 10));
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => reservation(db, `parallel-${index}`)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(19);
    expect(db.usage()).toBe(10);
  });

  it("restitue atomiquement un echec technique sans compteur negatif ni double restitution", async () => {
    const db = new FakeUsageDatabase(enabledSchool(0));
    await reservation(db, "failed");
    await expect(releaseSchoolAiUsage(db, "school-1", "secretary-1", "failed", month)).resolves.toBe("released");
    await expect(releaseSchoolAiUsage(db, "school-1", "secretary-1", "failed", month)).resolves.toBe("unchanged");
    expect(db.usage()).toBe(0);
    expect(db.reservation("failed")).toMatchObject({ status: "released" });
  });

  it("confirme une reservation sans increment supplementaire", async () => {
    const db = new FakeUsageDatabase(enabledSchool());
    await reservation(db, "success");
    await completeSchoolAiUsage(db, "school-1", "secretary-1", "success");
    await completeSchoolAiUsage(db, "school-1", "secretary-1", "success");
    expect(db.usage()).toBe(1);
    expect(db.reservation("success")).toMatchObject({ status: "completed" });
  });

  it("rend le rejeu idempotent et ne recompte pas la meme operation", async () => {
    const db = new FakeUsageDatabase(enabledSchool());
    await reservation(db, "same-request");
    await expect(reservation(db, "same-request")).rejects.toMatchObject({ code: "already-exists" });
    expect(db.usage()).toBe(1);
  });

  it("isole strictement les reservations de chaque ecole", async () => {
    const db = new FakeUsageDatabase(enabledSchool(), "school-a");
    db.documents.set("schools/school-b", enabledSchool());
    await reservation(db, "same-key", "school-a", "secretary-a");
    await reservation(db, "same-key", "school-b", "secretary-b");
    expect(db.usage("school-a")).toBe(1);
    expect(db.usage("school-b")).toBe(1);
  });

  it("reset refuse un role non autorise et accepte uniquement Super Admin", async () => {
    const db = new FakeUsageDatabase(enabledSchool(8));
    await expect(resetSchoolAiUsage(db, { schoolId: "school-1", actorId: "admin", actorRole: "school_admin", currentMonth: month })).rejects.toMatchObject({ code: "permission-denied" });
    await resetSchoolAiUsage(db, { schoolId: "school-1", actorId: "platform", actorRole: "super_admin", currentMonth: month });
    expect(db.usage()).toBe(0);
  });

  it("serialise de facon deterministe reset et reservation", async () => {
    const db = new FakeUsageDatabase(enabledSchool(4));
    const reset = resetSchoolAiUsage(db, { schoolId: "school-1", actorId: "platform", actorRole: "super_admin", currentMonth: month });
    const use = reservation(db, "after-reset");
    await Promise.all([reset, use]);
    expect(db.usage()).toBe(1);
  });

  it("conserve la lecture de configuration sans reservation pour la decision", async () => {
    const db = new FakeUsageDatabase(enabledSchool(3));
    await expect(prepareSchoolAiUsage(db, "school-1", { currentMonth: month, enforceLimit: false })).resolves.toMatchObject({ usage: { monthlyUsage: 3 } });
  });
});
