import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enforceApiRateLimit, HttpRateLimitError } from "./rateLimit.js";

function database() {
  const values = new Map<string, Record<string, unknown>>();
  let queue = Promise.resolve();
  return {
    values,
    doc: (path: string) => ({ path }),
    runTransaction: <T>(operation: (transaction: { get: (reference: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (reference: { path: string }, value: Record<string, unknown>) => void }) => Promise<T>) => {
      const result = queue.then(() => operation({ get: async (reference) => ({ exists: values.has(reference.path), data: () => values.get(reference.path) }), set: (reference, value) => { values.set(reference.path, value); } }));
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

describe("rate limiter API atomique", () => {
  it("accepte sous la limite, la dernière unité, puis refuse", async () => {
    const db = database(); const input = { db, actorId: "u1", schoolId: "s1", action: "finance", limit: 2, windowMs: 60_000, nowMs: 1_000 };
    await expect(enforceApiRateLimit(input)).resolves.toMatchObject({ remaining: 1 });
    await expect(enforceApiRateLimit(input)).resolves.toMatchObject({ remaining: 0 });
    await expect(enforceApiRateLimit(input)).rejects.toBeInstanceOf(HttpRateLimitError);
  });

  it("réinitialise la fenêtre et isole utilisateur, école et action", async () => {
    const db = database(); const base = { db, actorId: "u1", schoolId: "s1", action: "a1", limit: 1, windowMs: 1000, nowMs: 1_000 };
    await enforceApiRateLimit(base);
    await expect(enforceApiRateLimit({ ...base, actorId: "u2" })).resolves.toBeDefined();
    await expect(enforceApiRateLimit({ ...base, schoolId: "s2" })).resolves.toBeDefined();
    await expect(enforceApiRateLimit({ ...base, action: "a2" })).resolves.toBeDefined();
    await expect(enforceApiRateLimit({ ...base, nowMs: 2_001 })).resolves.toBeDefined();
  });

  it("n'autorise que dix appels concurrents sur vingt", async () => {
    const db = database(); const calls = Array.from({ length: 20 }, () => enforceApiRateLimit({ db, actorId: "u1", schoolId: "s1", action: "critical", limit: 10, windowMs: 60_000, nowMs: 1_000 }));
    const results = await Promise.allSettled(calls);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(10);
  });

  it("ne pénalise pas la répétition d'une requête idempotente", async () => {
    const db = database(); const input = { db, actorId: "u1", schoolId: "s1", action: "finance", limit: 1, windowMs: 60_000, nowMs: 1_000, idempotencyKey: "request-1" };
    await enforceApiRateLimit(input);
    await expect(enforceApiRateLimit(input)).resolves.toMatchObject({ idempotent: true });
  });

  it("ne dépend que d'une action canonique fournie par le serveur", async () => {
    const sourceFinance = readFileSync(new URL("../manage-financial-transaction.js", import.meta.url), "utf8");
    const sourceSchool = readFileSync(new URL("../manage-school.js", import.meta.url), "utf8");
    expect(sourceFinance).toContain('? requestedAction : "invalid"');
    expect(sourceSchool).toContain('? requestedAction : "invalid"');
  });
});
