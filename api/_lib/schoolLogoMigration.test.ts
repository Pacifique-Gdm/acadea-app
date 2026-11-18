import { FieldValue } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { cleanupLegacySchoolLogos, copySchoolLogos, readSchoolLogoInventory, restoreSchoolLogos } from "./schoolLogoMigration.js";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { schoolLogoVersion } from "./schoolLogo.js";

type Data = Record<string, unknown>;

/** Firestore en mémoire, juste assez pour la migration. */
function fakeDb(initial: Record<string, Data>) {
  const store = new Map<string, Data>(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
  const apply = (path: string, patch: Data, merge: boolean) => {
    const next: Data = merge ? { ...(store.get(path) ?? {}) } : {};
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object" && "isEqual" in value && (value as { isEqual: (other: unknown) => boolean }).isEqual(FieldValue.delete())) delete next[key];
      else next[key] = value;
    }
    store.set(path, next);
  };
  const snapshot = (path: string) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => (store.has(path) ? structuredClone(store.get(path)) : undefined) });
  const ref = (path: string) => ({ path, get: async () => snapshot(path), update: async (patch: Data) => { if (!store.has(path)) throw new Error("absent"); apply(path, patch, true); } });
  return {
    store,
    doc: ref,
    collection: (name: string) => ({
      get: async () => {
        const docs = [...store.keys()].filter((path) => path.startsWith(`${name}/`) && path.split("/").length === 2).map(snapshot);
        return { docs, size: docs.length };
      },
    }),
    runTransaction: async (run: (transaction: unknown) => Promise<unknown>) => run({
      get: async (target: { path: string }) => snapshot(target.path),
      set: (target: { path: string }, data: Data) => apply(target.path, data, false),
      update: (target: { path: string }, patch: Data) => apply(target.path, patch, true),
    }),
  };
}

const LOGO_A = "data:image/png;base64,QUFBQQ==";
const LOGO_B = "data:image/jpeg;base64,QkJCQg==";

function schools() {
  return {
    "schools/a": { name: "École A", status: "active", logoUrl: LOGO_A },
    "schools/b": { name: "École B", status: "active", logoUrl: LOGO_B, motto: "Devise" },
    "schools/c": { name: "École C", status: "active", logoUrl: "" },
    "schools/d": { name: "École D", status: "active" },
  };
}

describe("migration du logo de l'école", () => {
  it("la simulation n'écrit rien", async () => {
    const db = fakeDb(schools());
    const before = JSON.stringify([...db.store]);
    const result = await copySchoolLogos({ db, apply: false });
    expect(result).toMatchObject({ mode: "simulation", schools: 4, toCopy: 2, withoutLogo: 2, copied: 0 });
    expect(JSON.stringify([...db.store])).toBe(before);
    const cleanup = await cleanupLegacySchoolLogos({ db, apply: false });
    expect(cleanup.refused).toBeTruthy();
    expect(JSON.stringify([...db.store])).toBe(before);
  });

  it("copie chaque logo à l'identique sans retirer l'ancien champ, et peut être relancée", async () => {
    const db = fakeDb(schools());
    const result = await copySchoolLogos({ db, apply: true, now: () => "2026-11-18T00:00:00.000Z" });
    expect(result).toMatchObject({ copied: 2, verifiedAfterCopy: true, remainingToCopy: [] });
    expect(db.store.get("schoolLogos/a")).toEqual({ schoolId: "a", logoUrl: LOGO_A, logoVersion: schoolLogoVersion(LOGO_A), updatedAt: "2026-11-18T00:00:00.000Z", updatedBy: "migration-logo-ecole" });
    expect(db.store.get("schools/a")).toMatchObject({ logoUrl: LOGO_A, logoVersion: schoolLogoVersion(LOGO_A) });
    expect(db.store.get("schools/b")).toMatchObject({ logoUrl: LOGO_B, motto: "Devise" });
    expect(db.store.has("schoolLogos/c")).toBe(false);
    const again = await copySchoolLogos({ db, apply: true });
    expect(again).toMatchObject({ toCopy: 0, alreadyCopied: 2, copied: 0 });
  });

  it("refuse tout retrait si un seul logo n'est pas recopié à l'identique", async () => {
    const db = fakeDb(schools());
    await copySchoolLogos({ db, apply: true });
    db.store.set("schoolLogos/b", { ...db.store.get("schoolLogos/b"), logoUrl: "data:image/png;base64,QUJD" });
    const result = await cleanupLegacySchoolLogos({ db, apply: true });
    expect(result.unverified).toEqual(["b"]);
    expect(result.removed).toBe(0);
    expect(db.store.get("schools/a")).toHaveProperty("logoUrl", LOGO_A);
  });

  it("retire l'ancien champ après vérification, puis le retour arrière remet tout à l'identique", async () => {
    const db = fakeDb(schools());
    const backup = { projectId: "test", ...(await readSchoolLogoInventory(db)) };
    const schoolDocs = () => Object.fromEntries([...db.store].filter(([path]) => path.startsWith("schools/")));
    const original = structuredClone(schoolDocs());
    await copySchoolLogos({ db, apply: true });
    const cleanup = await cleanupLegacySchoolLogos({ db, apply: true });
    expect(cleanup).toMatchObject({ withLegacyField: 3, removed: 3, unverified: [] });
    expect(db.store.get("schools/a")).not.toHaveProperty("logoUrl");
    expect(db.store.get("schools/a")).toHaveProperty("logoVersion", schoolLogoVersion(LOGO_A));
    expect(db.store.get("schools/c")).toEqual({ name: "École C", status: "active", logoVersion: "" });
    expect(db.store.get("schoolLogos/a")).toHaveProperty("logoUrl", LOGO_A);

    const simulation = await restoreSchoolLogos({ db, backup, apply: false });
    expect(simulation.toRestore).toEqual(["a", "b", "c"]);
    expect(db.store.get("schools/a")).not.toHaveProperty("logoUrl");
    const restored = await restoreSchoolLogos({ db, backup, apply: true });
    expect(restored.restored).toBe(3);
    expect(schoolDocs()).toEqual(original);
  });

  it("le retour arrière n'écrase pas un logo changé depuis par l'école, sauf demande expresse", async () => {
    const db = fakeDb(schools());
    const backup = { projectId: "test", ...(await readSchoolLogoInventory(db)) };
    await copySchoolLogos({ db, apply: true });
    await cleanupLegacySchoolLogos({ db, apply: true });
    db.store.set("schools/a", { ...db.store.get("schools/a"), logoVersion: "nouveau-logo" });
    const result = await restoreSchoolLogos({ db, backup, apply: true });
    expect(result.changedSince).toEqual(["a"]);
    expect(db.store.get("schools/a")).toHaveProperty("logoVersion", "nouveau-logo");
    const forced = await restoreSchoolLogos({ db, backup, apply: true, force: true });
    expect(forced.toRestore).toContain("a");
    expect(db.store.get("schools/a")).toHaveProperty("logoUrl", LOGO_A);
  });

  it("refuse une sauvegarde abîmée", async () => {
    const db = fakeDb(schools());
    const backup = { projectId: "test", ...(await readSchoolLogoInventory(db)) };
    backup.schools[0].logoUrl = "data:image/png;base64,QUJD";
    await expect(restoreSchoolLogos({ db, backup, apply: true })).rejects.toThrow(/abîmée/);
  });
});
