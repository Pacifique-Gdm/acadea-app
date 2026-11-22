import { describe, expect, it } from "vitest";
import { parsePushDeviceInput, pushDeviceRegistryId, registerPushDevice } from "./pushDeviceRegistry.js";

type Row = Record<string, unknown>;

/** Fausse base Firestore minimale : documents, sous-collections filtrées par égalité, transactions. */
function fakeDb(initial: Record<string, Row>) {
  const records = new Map(Object.entries(initial));
  const ref = (path: string) => ({ path });
  const snapshot = (path: string) => ({ exists: records.has(path), data: () => records.get(path), ref: ref(path) });
  const db = {
    records,
    doc: (path: string) => ref(path),
    collection: (path: string) => ({
      where: (field: string, _op: string, value: unknown) => ({ query: { path, field, value } }),
    }),
    async runTransaction<T>(work: (transaction: unknown) => Promise<T>) {
      const writes: Array<() => void> = [];
      const transaction = {
        async get(target: { path?: string; query?: { path: string; field: string; value: unknown } }) {
          if (target.query) {
            const { path, field, value } = target.query;
            const docs = [...records.keys()]
              .filter((key) => key.startsWith(path + "/") && key.split("/").length === path.split("/").length + 1)
              .filter((key) => records.get(key)?.[field] === value)
              .map((key) => snapshot(key));
            return { docs };
          }
          return snapshot(target.path!);
        },
        set(target: { path: string }, value: Row) { writes.push(() => records.set(target.path, value)); },
        delete(target: { path: string }) { writes.push(() => records.delete(target.path)); },
      };
      const result = await work(transaction);
      writes.forEach((write) => write());
      return result;
    },
  };
  return db;
}

const TOKEN = "jeton-fcm-du-navigateur";
const registry = `pushDevices/${pushDeviceRegistryId(TOKEN)}`;

describe("P4 lot 4 — un navigateur n'appartient qu'au dernier compte", () => {
  it("le compte B qui présente le même jeton détache le document de A ; l'autre appareil de A reste", async () => {
    const db = fakeDb({
      "users/a/pushTokens/telephone-partage": { userId: "a", deviceId: "telephone-partage", token: TOKEN, active: true },
      "users/a/pushTokens/ordinateur-a": { userId: "a", deviceId: "ordinateur-a", token: "autre-jeton", active: true },
      "users/b/pushTokens/telephone-partage": { userId: "b", deviceId: "telephone-partage", token: TOKEN, active: true },
      [registry]: { userId: "a", deviceId: "telephone-partage" },
    });
    await expect(registerPushDevice(db, { uid: "b" }, { deviceId: "telephone-partage", token: TOKEN })).resolves.toEqual({ registered: true, detached: 1 });
    expect(db.records.has("users/a/pushTokens/telephone-partage")).toBe(false);
    expect(db.records.has("users/a/pushTokens/ordinateur-a")).toBe(true);
    expect(db.records.has("users/b/pushTokens/telephone-partage")).toBe(true);
    expect(db.records.get(registry)).toMatchObject({ userId: "b", deviceId: "telephone-partage" });
  });

  it("le même compte qui se réinscrit ne supprime rien", async () => {
    const db = fakeDb({
      "users/a/pushTokens/telephone": { userId: "a", deviceId: "telephone", token: TOKEN },
      [registry]: { userId: "a", deviceId: "telephone" },
    });
    await expect(registerPushDevice(db, { uid: "a" }, { deviceId: "telephone", token: TOKEN })).resolves.toEqual({ registered: true, detached: 0 });
    expect(db.records.has("users/a/pushTokens/telephone")).toBe(true);
  });

  it("premier enregistrement : le registre est créé, rien n'est supprimé", async () => {
    const db = fakeDb({ "users/b/pushTokens/telephone": { userId: "b", deviceId: "telephone", token: TOKEN } });
    await expect(registerPushDevice(db, { uid: "b" }, { deviceId: "telephone", token: TOKEN })).resolves.toEqual({ registered: true, detached: 0 });
    expect(db.records.get(registry)).toMatchObject({ userId: "b" });
  });

  it("refuse un jeton que l'appelant n'a pas lui-même enregistré (impossible de détacher le jeton d'un autre)", async () => {
    const db = fakeDb({
      "users/a/pushTokens/telephone": { userId: "a", deviceId: "telephone", token: TOKEN },
      [registry]: { userId: "a", deviceId: "telephone" },
    });
    await expect(registerPushDevice(db, { uid: "b" }, { deviceId: "telephone", token: TOKEN })).rejects.toMatchObject({ statusCode: 409 });
    expect(db.records.has("users/a/pushTokens/telephone")).toBe(true);
    expect(db.records.get(registry)).toMatchObject({ userId: "a" });
  });

  it("refuse des valeurs invalides", () => {
    expect(() => parsePushDeviceInput({ deviceId: "../x", token: TOKEN })).toThrow();
    expect(() => parsePushDeviceInput({ deviceId: "telephone", token: "" })).toThrow();
    expect(() => parsePushDeviceInput({ deviceId: "telephone", token: "x".repeat(5000) })).toThrow();
    expect(parsePushDeviceInput({ deviceId: "3f1c9a2e-0b1d-4c6e-9f00-123456789abc", token: TOKEN }).deviceId).toBe("3f1c9a2e-0b1d-4c6e-9f00-123456789abc");
  });

  it("le registre ne contient jamais le jeton en clair", () => {
    expect(pushDeviceRegistryId(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(pushDeviceRegistryId(TOKEN)).not.toContain(TOKEN);
  });
});
