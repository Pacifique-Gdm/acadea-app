import { describe, expect, it } from "vitest";
import { createServicePersonnel, normalizeServiceJobTitle } from "./provision-school-account.js";

type Data = Record<string, unknown>;
class MemoryDb {
  values = new Map<string, Data>();
  doc(path: string) { return { path, id: path.split("/").at(-1), get: async () => this.snapshot(path) }; }
  snapshot(path: string) { const value = this.values.get(path); return { exists: Boolean(value), data: () => value }; }
  collection(name: string) { return { doc: (id: string) => this.doc(`${name}/${id}`), where: (key: string, _operator: string, value: unknown) => ({ get: async () => ({ docs: [...this.values].filter(([path, data]) => path.startsWith(`${name}/`) && data[key] === value).map(([, data]) => ({ data: () => data })) }) }) }; }
  async runTransaction<T>(fn: (transaction: { get: (ref: { path: string }) => Promise<ReturnType<MemoryDb["snapshot"]>>; create: (ref: { path: string }, value: Data) => void; set: (ref: { path: string }, value: Data) => void }) => Promise<T>) {
    const writes: Array<() => void> = [];
    const result = await fn({
      get: async (ref) => this.snapshot(ref.path),
      create: (ref, value) => writes.push(() => { if (this.values.has(ref.path)) throw new Error("duplicate"); this.values.set(ref.path, value); }),
      set: (ref, value) => writes.push(() => this.values.set(ref.path, value)),
    });
    writes.forEach((write) => write());
    return result;
  }
}
const body = { action: "create-service-personnel", schoolId: "school-a", name: "Vigile E2E", phone: "+243812345678", jobTitle: "Vigile" };
function seeded() {
  const db = new MemoryDb();
  db.values.set("schools/school-a", { status: "active" });
  db.values.set("users/admin-a", { role: "school_admin", schoolId: "school-a" });
  db.values.set("users/secretary-a", { role: "secretary", schoolId: "school-a" });
  return db;
}

describe("personnel de service sans compte", () => {
  it.each(["school_admin", "secretary"])("crée la fiche par %s sans identité Auth ni users", async (role) => {
    const db = seeded();
    const result = await createServicePersonnel({ db, caller: { uid: role === "school_admin" ? "admin-a" : "secretary-a", role, schoolId: "school-a" }, body }) as { personnel: { id: string; kind: string; matricule: string } };
    expect(result.personnel.kind).toBe("service");
    expect(result.personnel.matricule).toMatch(/^PER-/);
    expect(db.values.has(`personnelProfiles/${result.personnel.id}`)).toBe(true);
    expect([...db.values.keys()].filter((path) => path.startsWith("users/"))).toHaveLength(2);
  });
  it("refuse compte déguisé, autre école, autre rôle et numéro déjà utilisé", async () => {
    const db = seeded();
    const caller = { uid: "secretary-a", role: "secretary", schoolId: "school-a" };
    await expect(createServicePersonnel({ db, caller, body: { ...body, role: "parent", password: "secret" } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(createServicePersonnel({ db, caller: { ...caller, schoolId: "school-b" }, body })).rejects.toMatchObject({ statusCode: 403 });
    await expect(createServicePersonnel({ db, caller: { ...caller, role: "parent" }, body })).rejects.toMatchObject({ statusCode: 403 });
    db.values.set("users/another", { schoolId: "school-a", phone: "+243812345678", role: "teacher" });
    await expect(createServicePersonnel({ db, caller, body })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("interdit une fonction de compte Acadéa sous Autre", () => {
    expect(() => normalizeServiceJobTitle("Autre fonction", "Directeur des études")).toThrow();
    expect(normalizeServiceJobTitle("Autre fonction", "Bibliothécaire")).toBe("Bibliothécaire");
  });
});
