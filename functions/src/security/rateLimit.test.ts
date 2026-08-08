import { describe, expect, it } from "vitest";
import { enforceCallableRateLimit, type RateLimitDatabase } from "./rateLimit.js";

function database(): RateLimitDatabase {
  const values = new Map<string, Record<string, unknown>>(); let queue = Promise.resolve();
  return { doc: (path) => ({ path }), runTransaction: <T>(operation: Parameters<RateLimitDatabase["runTransaction"]>[0]) => { const result = queue.then(() => operation({ get: async (reference) => ({ exists: values.has(reference.path ?? ""), data: () => values.get(reference.path ?? "") }), set: (reference, value) => { values.set(reference.path ?? "", value); } })); queue = result.then(() => undefined, () => undefined); return result as Promise<T>; } };
}

describe("rate limiter Callable atomique", () => {
  it("accepte la dernière unité et renvoie resource-exhausted ensuite", async () => {
    const db = database(); const input = { db, actorId: "u1", schoolId: "s1", action: "ai", limit: 2, windowMs: 60_000, nowMs: 1_000 };
    await enforceCallableRateLimit(input); await expect(enforceCallableRateLimit(input)).resolves.toMatchObject({ remaining: 0 });
    await expect(enforceCallableRateLimit(input)).rejects.toMatchObject({ code: "resource-exhausted", details: { retryAfter: 60 } });
  });

  it("isole utilisateurs, écoles, actions et expire la fenêtre", async () => {
    const db = database(); const base = { db, actorId: "u1", schoolId: "s1", action: "a1", limit: 1, windowMs: 1000, nowMs: 1_000 };
    await enforceCallableRateLimit(base);
    await expect(enforceCallableRateLimit({ ...base, actorId: "u2" })).resolves.toBeDefined();
    await expect(enforceCallableRateLimit({ ...base, schoolId: "s2" })).resolves.toBeDefined();
    await expect(enforceCallableRateLimit({ ...base, action: "a2" })).resolves.toBeDefined();
    await expect(enforceCallableRateLimit({ ...base, nowMs: 2_001 })).resolves.toBeDefined();
  });

  it("accepte exactement dix appels concurrents sur vingt", async () => {
    const db = database(); const results = await Promise.allSettled(Array.from({ length: 20 }, () => enforceCallableRateLimit({ db, actorId: "u1", schoolId: "s1", action: "delete", limit: 10, windowMs: 60_000, nowMs: 1_000 })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(10);
  });

  it("préserve les répétitions idempotentes SEC-003", async () => {
    const db = database(); const input = { db, actorId: "u1", schoolId: "s1", action: "ai", limit: 1, windowMs: 60_000, idempotencyKey: "request-1", nowMs: 1_000 };
    await enforceCallableRateLimit(input);
    await expect(enforceCallableRateLimit(input)).resolves.toMatchObject({ idempotent: true });
  });
});
