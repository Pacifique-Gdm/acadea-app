import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { incrementSchoolAiUsageAfterSuccess, prepareSchoolAiUsage, type AiUsageDatabase } from "./schoolAiUsage.js";

class FakeUsageDatabase implements AiUsageDatabase {
  data?: Record<string, unknown>;
  private queue = Promise.resolve();
  constructor(data?: Record<string, unknown>) { this.data = data; }
  doc(path: string) { return path; }
  runTransaction<T>(operation: (transaction: { get(reference: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; update(reference: unknown, patch: Record<string, unknown>): void }) => Promise<T>) {
    const run = this.queue.then(() => operation({
      get: async () => ({ exists: Boolean(this.data), data: () => this.data }),
      update: (_reference, patch) => {
        const ai = { ...((this.data?.aiAssistant as Record<string, unknown> | undefined) ?? {}) };
        for (const [key, value] of Object.entries(patch)) ai[key.replace("aiAssistant.", "")] = value;
        this.data = { ...(this.data ?? {}), aiAssistant: ai };
      },
    }));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

const enabledSchool = (monthlyUsage = 0, monthlyLimit = 25, usageMonth = "2026-07") => ({ aiAssistant: { enabled: true, monthlyUsage, monthlyLimit, usageMonth } });

describe("quota mensuel de l’Assistant IA", () => {
  it("accepte une IA activée dont le quota n'est pas atteint", async () => {
    const db = new FakeUsageDatabase(enabledSchool(12));
    await expect(prepareSchoolAiUsage(db, "school-1", { currentMonth: "2026-07" })).resolves.toMatchObject({ usage: { monthlyUsage: 12, monthlyLimit: 25 } });
  });

  it("refuse une IA désactivée", async () => {
    await expect(prepareSchoolAiUsage(new FakeUsageDatabase({ aiAssistant: { enabled: false } }), "school-1", { currentMonth: "2026-07" })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("refuse un quota atteint", async () => {
    await expect(prepareSchoolAiUsage(new FakeUsageDatabase(enabledSchool(25)), "school-1", { currentMonth: "2026-07" })).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("remet le compteur à zéro lors du changement de mois", async () => {
    const db = new FakeUsageDatabase(enabledSchool(20, 25, "2026-06"));
    await expect(prepareSchoolAiUsage(db, "school-1", { currentMonth: "2026-07" })).resolves.toMatchObject({ usage: { monthlyUsage: 0, usageMonth: "2026-07" } });
    expect(db.data?.aiAssistant).toMatchObject({ monthlyUsage: 0, usageMonth: "2026-07" });
  });

  it("utilise les valeurs par défaut et refuse une école inexistante", async () => {
    await expect(prepareSchoolAiUsage(new FakeUsageDatabase(), "missing", { currentMonth: "2026-07" })).rejects.toMatchObject({ code: "not-found" });
    await expect(prepareSchoolAiUsage(new FakeUsageDatabase({ aiAssistant: { enabled: true } }), "school-1", { currentMonth: "2026-07" })).resolves.toMatchObject({ usage: { monthlyUsage: 0, monthlyLimit: 25 } });
  });

  it("incrémente atomiquement uniquement après succès", async () => {
    const db = new FakeUsageDatabase(enabledSchool(2));
    await incrementSchoolAiUsageAfterSuccess(db, "school-1", "2026-07");
    expect(db.data?.aiAssistant).toMatchObject({ monthlyUsage: 3 });
    const handler = readFileSync(new URL("./writingAssistant.ts", import.meta.url), "utf8");
    expect(handler.indexOf("await incrementSchoolAiUsageAfterSuccess")).toBeGreaterThan(handler.indexOf("if (!response.ok)"));
  });

  it("sérialise les incréments concurrents sans dépasser le quota", async () => {
    const db = new FakeUsageDatabase(enabledSchool(0, 2));
    const results = await Promise.allSettled([
      incrementSchoolAiUsageAfterSuccess(db, "school-1", "2026-07"),
      incrementSchoolAiUsageAfterSuccess(db, "school-1", "2026-07"),
      incrementSchoolAiUsageAfterSuccess(db, "school-1", "2026-07"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(db.data?.aiAssistant).toMatchObject({ monthlyUsage: 2 });
  });
});
