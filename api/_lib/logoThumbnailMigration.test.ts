import { FieldValue } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { migrateLogos, readLogoInventory, restoreLogos, verifyLogoMigration } from "./logoThumbnailMigration.js";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { schoolLogoVersion } from "./schoolLogo.js";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { resolveLogoMigrationTarget } from "../../scripts/logoThumbnailMigration.mjs";

type Data = Record<string, unknown>;

/** Firestore en mémoire, juste assez pour la migration. */
function fakeDb(initial: Record<string, Data>) {
  const store = new Map<string, Data>(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
  const apply = (path: string, patch: Data, merge: boolean) => {
    const next: Data = merge ? { ...(store.get(path) ?? {}) } : {};
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object" && "isEqual" in value && (value as { isEqual: (other: unknown) => boolean }).isEqual(FieldValue.delete())) delete next[key];
      else next[key] = structuredClone(value);
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
      update: (target: { path: string }, patch: Data) => { if (!store.has(target.path)) throw new Error("absent"); apply(target.path, patch, true); },
      delete: (target: { path: string }) => store.delete(target.path),
    }),
  };
}

const LOGO_A = "data:image/png;base64,QUFBQQ==";
const LOGO_B = "data:image/jpeg;base64,QkJCQg==";
const LOGO_C = "data:image/png;base64,Q0NDQw==";
const THUMB = `data:image/webp;base64,${"T".repeat(4000)}`;
const makeThumbnail = async (logoUrl: string) => (logoUrl ? THUMB : "");

function initial() {
  return {
    // École migrée le 18/11 (logo rangé à part), école encore sur l'ancien champ, école sans logo.
    "schools/a": { name: "École A", logoVersion: "va" },
    "schoolLogos/a": { schoolId: "a", logoUrl: LOGO_A, logoVersion: "va" },
    "schools/b": { name: "École B", logoUrl: LOGO_B },
    "schools/c": { name: "École C" },
    // Coordination avec logo dans son document, coordination sans logo.
    "coordinations/k": { name: "Coordination K", status: "active", logoUrl: LOGO_C },
    "coordinations/l": { name: "Coordination L", status: "active" },
  };
}

const snapshotOf = (db: ReturnType<typeof fakeDb>) => JSON.stringify([...db.store].sort(([left], [right]) => left.localeCompare(right)));

describe("migration des vignettes et des logos des coordinations", () => {
  it("la simulation n'écrit rien et compte ce qui sera écrit", async () => {
    const db = fakeDb(initial());
    const before = snapshotOf(db);
    const result = await migrateLogos({ db, makeThumbnail, apply: false });
    expect(result).toMatchObject({ mode: "simulation", schools: 3, coordinations: 2, schoolThumbnails: 2, coordinationMoves: 1, schoolsWithoutLogo: 1, thumbnailsWritten: 0, coordinationsMoved: 0 });
    expect(snapshotOf(db)).toBe(before);
  });

  it("crée les vignettes, déplace le logo de la coordination, puis se vérifie", async () => {
    const db = fakeDb(initial());
    const result = await migrateLogos({ db, makeThumbnail, apply: true, now: () => "2026-11-21T00:00:00.000Z" });
    expect(result).toMatchObject({ thumbnailsWritten: 2, coordinationsMoved: 1, skipped: [], verification: { ok: true, problems: [] } });
    expect(db.store.get("schools/a")).toEqual({ name: "École A", logoVersion: "va", logoThumbUrl: THUMB });
    expect(db.store.get("schools/b")).toMatchObject({ logoUrl: LOGO_B, logoThumbUrl: THUMB });
    expect(db.store.get("schools/c")).toEqual({ name: "École C" });
    expect(db.store.get("coordinations/k")).toEqual({ name: "Coordination K", status: "active", logoVersion: schoolLogoVersion(LOGO_C), logoThumbUrl: THUMB });
    expect(db.store.get("coordinationLogos/k")).toEqual({ coordinationId: "k", logoUrl: LOGO_C, logoVersion: schoolLogoVersion(LOGO_C), updatedAt: "2026-11-21T00:00:00.000Z", updatedBy: "migration-vignettes-logos" });
    expect(db.store.has("coordinationLogos/l")).toBe(false);
    // Relancer ne refait rien.
    expect(await migrateLogos({ db, makeThumbnail, apply: true })).toMatchObject({ thumbnailsWritten: 0, coordinationsMoved: 0 });
  });

  it("n'écrit jamais une vignette trop lourde", async () => {
    const db = fakeDb(initial());
    const result = await migrateLogos({ db, makeThumbnail: async () => `data:image/webp;base64,${"T".repeat(9000)}`, apply: true });
    expect(result.thumbnailsWritten).toBe(0);
    expect(db.store.get("schools/a")).not.toHaveProperty("logoThumbUrl");
    expect(db.store.get("coordinations/k")).not.toHaveProperty("logoThumbUrl");
    expect(result.verification.ok).toBe(false);
  });

  it("le retour arrière remet exactement l'état de la sauvegarde", async () => {
    const db = fakeDb(initial());
    const before = snapshotOf(db);
    const backup = await readLogoInventory(db);
    await migrateLogos({ db, makeThumbnail, apply: true });
    expect(snapshotOf(db)).not.toBe(before);
    const simulation = await restoreLogos({ db, backup, apply: false });
    expect(simulation).toMatchObject({ schoolsRestored: 2, coordinationsRestored: 1, changedSince: [] });
    expect(snapshotOf(db)).not.toBe(before);
    const restored = await restoreLogos({ db, backup, apply: true });
    expect(restored).toMatchObject({ schoolsRestored: 2, coordinationsRestored: 1, unchanged: 2 });
    expect(snapshotOf(db)).toBe(before);
    // Migration refaite après le retour arrière : même résultat qu'à la première fois.
    expect((await migrateLogos({ db, makeThumbnail, apply: true })).verification.ok).toBe(true);
  });

  it("le retour arrière ne casse pas un logo changé depuis par l'école, sauf --force", async () => {
    const db = fakeDb(initial());
    const backup = await readLogoInventory(db);
    await migrateLogos({ db, makeThumbnail, apply: true });
    await db.doc("schools/a").update({ logoVersion: "nouveau", logoThumbUrl: THUMB });
    const result = await restoreLogos({ db, backup, apply: true });
    expect(result.changedSince).toEqual(["a"]);
    expect(db.store.get("schools/a")).toMatchObject({ logoVersion: "nouveau", logoThumbUrl: THUMB });
  });

  it("refuse une sauvegarde abîmée", async () => {
    const db = fakeDb(initial());
    const backup = await readLogoInventory(db);
    backup.coordinations[0].logoUrl.value = LOGO_A;
    await expect(restoreLogos({ db, backup, apply: true })).rejects.toThrow(/abîmée/);
  });

  it("la vérification signale un logo de coordination non déplacé", async () => {
    const db = fakeDb(initial());
    const backup = await readLogoInventory(db);
    const check = await verifyLogoMigration({ db, backup });
    expect(check.ok).toBe(false);
    expect(check.problems.map((problem: { id: string }) => problem.id).sort()).toEqual(["a", "b", "k"]);
  });
});

describe("gardes du script de migration", () => {
  const production = { GOOGLE_CLOUD_PROJECT: "acadea-production", ACADEA_PRODUCTION_MIGRATION: "YES", ACADEA_PRODUCTION_ACCESS_TOKEN: "jeton" };
  const staging = { GOOGLE_CLOUD_PROJECT: "acadea-staging", ACADEA_LOGO_MIGRATION_STAGING: "YES", ACADEA_STAGING_ACCESS_TOKEN: "jeton" };

  it("refuse la production sans --production-autorisee=OUI, même avec toutes les autres confirmations", () => {
    const args = { project: "acadea-production", "confirm-production": "acadea-production", step: "migrate", apply: true };
    expect(() => resolveLogoMigrationTarget(args, production)).toThrow(/production-autorisee=OUI/);
    expect(() => resolveLogoMigrationTarget({ ...args, "production-autorisee": "oui" }, production)).toThrow(/production-autorisee=OUI/);
    expect(resolveLogoMigrationTarget({ ...args, "production-autorisee": "OUI" }, production)).toMatchObject({ projectId: "acadea-production", apply: true });
  });

  it("vise le staging par défaut, en simulation sans --apply, et exige un dossier de sauvegarde", () => {
    expect(resolveLogoMigrationTarget({ step: "migrate" }, staging)).toMatchObject({ projectId: "acadea-staging", apply: false });
    expect(() => resolveLogoMigrationTarget({ step: "backup" }, staging)).toThrow(/backup-dir/);
    expect(() => resolveLogoMigrationTarget({ step: "migrate" }, { ...staging, ACADEA_LOGO_MIGRATION_STAGING: "" })).toThrow(/autorisation/);
    expect(() => resolveLogoMigrationTarget({ step: "migrate" }, { ...staging, FIRESTORE_EMULATOR_HOST: "x" })).toThrow(/Émulateur/);
  });
});
