import { describe, expect, it } from "vitest";
// @ts-expect-error module JavaScript du serveur
import { createAuthUserOnce, ACCOUNT_EMAIL_LOCK_MS } from "./accountEmailLock.js";

function fakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const doc = (path: string) => ({
    create: async (value: Record<string, unknown>) => {
      await Promise.resolve();
      if (store.has(path)) throw Object.assign(new Error("already exists"), { code: 6 });
      store.set(path, value);
    },
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    delete: async () => { store.delete(path); },
  });
  return { store, db: { doc } };
}

function fakeAuth(delayMs = 20) {
  const users: { email: string; uid: string }[] = [];
  return {
    users,
    getUserByEmail: async (email: string) => {
      const user = users.find((entry) => entry.email === email);
      if (!user) throw Object.assign(new Error("absent"), { code: "auth/user-not-found" });
      return user;
    },
    // Comme dans le cas réel observé : la création elle-même ne refuse pas une adresse déjà prise.
    createUser: async ({ email }: { email: string }) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const user = { email, uid: `u${users.length + 1}` };
      users.push(user);
      return user;
    },
  };
}

describe("verrou de création de compte par adresse e-mail", () => {
  it("deux demandes simultanées pour la même adresse : un seul compte est créé", async () => {
    const { db, store } = fakeDb();
    const auth = fakeAuth();
    const results = await Promise.allSettled([
      createAuthUserOnce(auth, db, { email: "caissier@ecole.cd", password: "secret1" }),
      createAuthUserOnce(auth, db, { email: "Caissier@ecole.cd ", password: "secret1" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.statusCode).toBe(409);
    expect(refused.reason.code).toBe("auth/email-already-exists");
    expect(auth.users).toHaveLength(1);
    expect(store.size).toBe(0);
  });

  it("une adresse déjà utilisée est refusée, même après la fin du verrou", async () => {
    const { db } = fakeDb();
    const auth = fakeAuth(0);
    await createAuthUserOnce(auth, db, { email: "parent@ecole.cd", password: "secret1" });
    await expect(createAuthUserOnce(auth, db, { email: "parent@ecole.cd", password: "secret1" })).rejects.toMatchObject({ code: "auth/email-already-exists" });
    expect(auth.users).toHaveLength(1);
  });

  it("un vieux verrou oublié n'empêche rien, et des adresses différentes ne se gênent pas", async () => {
    const { db, store } = fakeDb();
    const auth = fakeAuth(0);
    let clock = Date.parse("2026-11-18T10:00:00Z");
    const { createHash } = await import("node:crypto");
    const key = `accountEmailLocks/${createHash("sha256").update("a@ecole.cd").digest("hex")}`;
    store.set(key, { token: "ancien", createdAt: new Date(clock - ACCOUNT_EMAIL_LOCK_MS - 1).toISOString() });
    await createAuthUserOnce(auth, db, { email: "a@ecole.cd" }, { now: () => clock });
    clock += ACCOUNT_EMAIL_LOCK_MS + 1;
    await createAuthUserOnce(auth, db, { email: "b@ecole.cd" }, { now: () => clock });
    expect(auth.users.map((user) => user.email)).toEqual(["a@ecole.cd", "b@ecole.cd"]);
  });
});
