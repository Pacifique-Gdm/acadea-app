import { beforeEach, describe, expect, it, vi } from "vitest";
import { manageCoordinationAdministrator } from "./coordinationAdministrators.js";

type Row = Record<string, unknown>;
type Ref = { id: string; path: string; get: () => Promise<{ exists: boolean; data: () => Row | undefined }> };
const rows = new Map<string, Row>();
let sequence = 0;
const auth = { createUser: vi.fn(), setCustomUserClaims: vi.fn(), deleteUser: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), revokeRefreshTokens: vi.fn() };
let failCommit = false;
function writer() {
  const writes: Array<() => void> = [];
  return {
    get: (ref: Ref) => ref.get(),
    create(ref: Ref, row: Row) { writes.push(() => { if (rows.has(ref.path)) throw new Error("exists"); rows.set(ref.path, row); }); },
    update(ref: Ref, row: Row) { writes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...row })); },
    async commit() { if (failCommit) throw new Error("Firestore indisponible"); writes.forEach((write) => write()); },
  };
}
const db = {
  doc(path: string): Ref { return { path, id: path.split("/").at(-1)!, get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }) }; },
  collection(name: string) { return { doc: () => db.doc(`${name}/${++sequence}`) }; },
  batch: writer,
  async runTransaction<T>(run: (transaction: ReturnType<typeof writer>) => Promise<T>) { const transaction = writer(); const result = await run(transaction); await transaction.commit(); return result; },
};
const coordination = { id: "coord-a", status: "active" };
const caller = { uid: "super", role: "super_admin" };
const execute = (input: Row, actor = caller) => manageCoordinationAdministrator({ auth, db, caller: actor, input: { coordinationId: "coord-a", ...input }, coordination, now: "2026-10-03T12:00:00Z" });
const create = (email = "test@example.test") => execute({ action: "create-coordinator", name: "Coordinateur test", email, phone: "123", password: "Temporary-test-only" });

describe("gestion sécurisée des Coordinateurs", () => {
  beforeEach(() => {
    rows.clear(); sequence = 0; failCommit = false; vi.resetAllMocks();
    rows.set("users/super", { role: "super_admin", status: "active" });
    rows.set("coordinations/coord-a", coordination);
    rows.set("schools/school-a", { activeCoordinationId: "coord-a" });
    rows.set("users/existing", { role: "coordination_admin", coordinationId: "coord-a", status: "active", active: true, email: "existing@example.test" });
    auth.createUser.mockImplementation(async () => ({ uid: `coord-user-${++sequence}` }));
    auth.getUser.mockResolvedValue({ disabled: false, email: "existing@example.test", displayName: "Original" });
  });
  it("ajoute trois Coordinateurs sans remplacer l'existant ni stocker de secret", async () => {
    await create("one@example.test"); await create("two@example.test"); await create("three@example.test");
    expect([...rows].filter(([path]) => path.startsWith("users/coord-user-"))).toHaveLength(3);
    expect(rows.get("users/existing")?.email).toBe("existing@example.test");
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(expect.any(String), { role: "coordination_admin", coordinationId: "coord-a" });
    expect(JSON.stringify([...rows])).not.toContain("Temporary-test-only");
    expect(rows.get("coordinations/coord-a")).toEqual(coordination);
  });
  it("compense Auth si la création Firestore échoue", async () => {
    failCommit = true;
    await expect(create()).rejects.toThrow("Firestore indisponible");
    expect(auth.deleteUser).toHaveBeenCalledOnce();
    expect([...rows.keys()].filter((key) => key.startsWith("users/coord-user-"))).toHaveLength(0);
  });
  it("compense Auth si les claims échouent", async () => {
    auth.setCustomUserClaims.mockRejectedValue(new Error("claims"));
    await expect(create()).rejects.toThrow("claims");
    expect(auth.deleteUser).toHaveBeenCalledOnce();
  });
  it("signale un e-mail déjà utilisé sans création partielle", async () => {
    auth.createUser.mockRejectedValue({ code: "auth/email-already-exists" });
    await expect(create()).rejects.toMatchObject({ statusCode: 409 });
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
  });
  it.each(["teacher", "coordination_admin", "sub_coordination_admin"])("refuse le rôle %s", async (role) => {
    await expect(execute({ action: "create-coordinator" }, { uid: "super", role })).rejects.toMatchObject({ statusCode: 403 });
    expect(auth.createUser).not.toHaveBeenCalled();
  });
  it.each([{ role: "super_admin", status: "inactive" }, { role: "super_admin", active: false }, { role: "coordination_admin", status: "active" }])("refuse un ancien token avec profil non autorisé %j", async (profile) => {
    rows.set("users/super", profile);
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuse un changement de rôle ou de scope injecté", async () => {
    await expect(execute({ action: "update-coordinator", userId: "existing", role: "super_admin" })).rejects.toMatchObject({ statusCode: 400 });
    rows.set("users/foreign", { role: "coordination_admin", coordinationId: "coord-b" });
    await expect(execute({ action: "suspend-coordinator", userId: "foreign" })).rejects.toMatchObject({ statusCode: 404 });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("modifie l'identité sans modifier son périmètre", async () => {
    await execute({ action: "update-coordinator", userId: "existing", name: "Modifié", email: "new@example.test", phone: "456" });
    expect(rows.get("users/existing")).toMatchObject({ name: "Modifié", email: "new@example.test", role: "coordination_admin", coordinationId: "coord-a" });
  });
  it("suspend Auth et users, révoque les sessions et réactive sans nouvelle logique d'état", async () => {
    await execute({ action: "suspend-coordinator", userId: "existing" });
    expect(auth.updateUser).toHaveBeenCalledWith("existing", { disabled: true });
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith("existing");
    expect(rows.get("users/existing")).toMatchObject({ status: "inactive", active: false });
    await execute({ action: "reactivate-coordinator", userId: "existing" });
    expect(rows.get("users/existing")).toMatchObject({ status: "active", active: true });
  });
  it("supprime seulement l'accès après confirmation, conserve écoles, Coordination, autres comptes et historique", async () => {
    await expect(execute({ action: "remove-coordinator", userId: "existing", confirmation: "NON" })).rejects.toMatchObject({ statusCode: 400 });
    await execute({ action: "remove-coordinator", userId: "existing", confirmation: "SUPPRIMER CE COORDINATEUR" });
    expect(rows.get("users/existing")).toMatchObject({ status: "inactive", active: false, removedAt: "2026-10-03T12:00:00Z" });
    expect(rows.get("coordinations/coord-a")).toEqual(coordination);
    expect(rows.has("schools/school-a")).toBe(true);
    expect(auth.deleteUser).not.toHaveBeenCalled();
    await expect(execute({ action: "reactivate-coordinator", userId: "existing" })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("restaure Auth si une modification de profil échoue", async () => {
    failCommit = true;
    await expect(execute({ action: "suspend-coordinator", userId: "existing" })).rejects.toThrow();
    expect(auth.updateUser).toHaveBeenLastCalledWith("existing", { disabled: false });
    expect(rows.get("users/existing")?.status).toBe("active");
  });
  it("modifie uniquement les informations autorisées de la Coordination", async () => {
    await execute({ action: "update-coordination", name: "Nouveau nom", code: "NN", phone: "123", email: "coord@example.test", address: "Adresse" });
    expect(rows.get("coordinations/coord-a")).toMatchObject({ name: "Nouveau nom", status: "active" });
    await expect(execute({ action: "update-coordination", name: "N", status: "inactive" })).rejects.toMatchObject({ statusCode: 400 });
  });
});
