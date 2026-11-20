import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PUSH_TOKEN_FORGET_DEADLINE_MS, forgetTokenThenSignOut } from "./signOutSequence";

afterEach(() => { vi.useRealTimers(); });

describe("P4 lot 1 : la déconnexion se termine toujours", () => {
  it("déconnecte même si le retrait du jeton ne se termine jamais (sans réseau)", async () => {
    vi.useFakeTimers();
    const signOut = vi.fn(async () => undefined);
    const never = () => new Promise<void>(() => undefined);
    const done = forgetTokenThenSignOut({ forget: never, signOut });
    await vi.advanceTimersByTimeAsync(PUSH_TOKEN_FORGET_DEADLINE_MS - 1);
    expect(signOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBe(false);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("déconnecte tout de suite après un retrait réussi", async () => {
    const order: string[] = [];
    const ok = await forgetTokenThenSignOut({ forget: async () => { order.push("jeton"); }, signOut: async () => { order.push("signOut"); } });
    expect(ok).toBe(true); expect(order).toEqual(["jeton", "signOut"]);
  });

  it("déconnecte malgré une erreur du retrait, et sans compte connu", async () => {
    const signOut = vi.fn(async () => undefined);
    await expect(forgetTokenThenSignOut({ forget: async () => { throw new Error("réseau"); }, signOut })).resolves.toBe(false);
    await expect(forgetTokenThenSignOut({ signOut })).resolves.toBe(false);
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it("signOutUser passe par la séquence bornée (plus d'attente sans limite du jeton)", () => {
    const source = readFileSync("src/services/auth.ts", "utf8");
    const body = source.slice(source.indexOf("export async function signOutUser"), source.indexOf("export async function createFirebaseAuthUser"));
    expect(body).toContain("forgetTokenThenSignOut");
    expect(body).not.toMatch(/await import\("\.\/pushNotifications"\)\.then\(\(module\) => module\.forgetDevicePushToken\(uid\)\)\.catch/);
  });
});
