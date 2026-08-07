import { describe, expect, it } from "vitest";
import { SCHOOL_OWNED_COLLECTIONS, deleteQueryPages, deleteSchoolAuthUsers, deleteSchoolCompletely, schoolDeletionInventory } from "./schoolDeletion.js";

type Data = Record<string, unknown>;

class FakeSnapshot {
  constructor(readonly ref: FakeDoc, private readonly value: Data | undefined) {}
  get id() { return this.ref.id; }
  get exists() { return this.value !== undefined; }
  data() { return this.value; }
}

class FakeDoc {
  constructor(readonly db: FakeDb, readonly path: string) {}
  get id() { return this.path.split("/").at(-1) ?? ""; }
  async get() { return new FakeSnapshot(this, this.db.documents.get(this.path)); }
  async update(value: Data) { if (!this.db.documents.has(this.path)) throw new Error("not-found"); this.db.documents.set(this.path, { ...this.db.documents.get(this.path), ...value }); }
  async set(value: Data, options?: { merge?: boolean }) { this.db.documents.set(this.path, options?.merge ? { ...this.db.documents.get(this.path), ...value } : value); }
  async delete() { this.db.order.push(`delete:${this.path}`); this.db.documents.delete(this.path); }
  collection(name: string) { return new FakeCollection(this.db, `${this.path}/${name}`); }
}

class FakeQuery {
  private maximum = Number.POSITIVE_INFINITY;
  constructor(readonly db: FakeDb, readonly path: string, readonly filters: [string, unknown][] = []) {}
  where(field: string, _operator: string, value: unknown) { return new FakeQuery(this.db, this.path, [...this.filters, [field, value]]); }
  limit(value: number) { const query = new FakeQuery(this.db, this.path, this.filters); query.maximum = value; return query; }
  async get() {
    const depth = this.path.split("/").length + 1;
    const docs = [...this.db.documents.entries()]
      .filter(([path, value]) => path.startsWith(`${this.path}/`) && path.split("/").length === depth && this.filters.every(([key, expected]) => value[key] === expected))
      .slice(0, this.maximum)
      .map(([path, value]) => new FakeSnapshot(new FakeDoc(this.db, path), value));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeCollection extends FakeQuery {
  doc(id: string) { return new FakeDoc(this.db, `${this.path}/${id}`); }
  async add(value: Data) { const ref = this.doc(`log-${this.db.logs++}`); await ref.set(value); return ref; }
}

class FakeDb {
  documents = new Map<string, Data>();
  order: string[] = [];
  logs = 0;
  doc(path: string) { return new FakeDoc(this, path); }
  collection(path: string) { return new FakeCollection(this, path); }
  batch() { const deleted: FakeDoc[] = []; return { delete: (ref: FakeDoc) => deleted.push(ref), commit: async () => { for (const ref of deleted) await ref.delete(); } }; }
  seed(path: string, value: Data) { this.documents.set(path, value); }
}

class FakeAuth {
  users = new Map<string, { customClaims?: Data }>();
  failOnce = new Set<string>();
  async getUser(uid: string) { const user = this.users.get(uid); if (!user) throw Object.assign(new Error("missing"), { code: "auth/user-not-found" }); return user; }
  async deleteUser(uid: string) { if (this.failOnce.delete(uid)) throw Object.assign(new Error("failure"), { code: "auth/internal-error" }); this.users.delete(uid); }
}

class FakeBucket {
  files = new Set<string>();
  async getFiles({ prefix }: { prefix: string }) { return [[...this.files].filter((name) => name.startsWith(prefix)).map((name) => ({ name, delete: async () => { this.files.delete(name); } }))]; }
  file(name: string) { return { delete: async () => { this.files.delete(name); } }; }
}

function seedSchool(db: FakeDb, schoolId: string, uid: string) {
  db.seed(`schools/${schoolId}`, { id: schoolId, status: "active", mainAdminId: uid });
  for (const collection of SCHOOL_OWNED_COLLECTIONS) db.seed(`${collection}/${collection}-${schoolId}`, { schoolId });
  db.seed(`users/${uid}`, { id: uid, role: "school_admin", schoolId });
  db.seed(`users/${uid}/pushTokens/token`, { active: true });
  db.seed(`schools/${schoolId}/aiUsageReservations/request`, { schoolId });
  db.seed(`messageIdempotency/${schoolId}/signals/signal`, { schoolId });
}

describe("SEC-004 school deletion", () => {
  it("centralise toutes les ressources sensibles connues", () => {
    const inventory = schoolDeletionInventory();
    expect(inventory.collections).toEqual(expect.arrayContaining(["correspondences", "secretaryReports", "secretaryCounters", "studentMedicalRecords", "aiUsageLogs", "attendanceSettings", "financialCounters", "financialIdempotency"]));
    expect(inventory.storagePrefixes).toEqual(["valves/{schoolId}/", "schools/{schoolId}/"]);
  });

  it("supprime par pages bornées", async () => {
    const db = new FakeDb();
    for (let index = 0; index < 601; index += 1) db.seed(`payments/p-${index}`, { schoolId: "school-a" });
    expect(await deleteQueryPages(db, db.collection("payments").where("schoolId", "==", "school-a"), 250)).toBe(601);
    expect(db.documents.size).toBe(0);
  });

  it("supprime exhaustivement A sans toucher B et place l'école en dernier", async () => {
    const db = new FakeDb(); const auth = new FakeAuth(); const bucket = new FakeBucket();
    seedSchool(db, "school-a", "admin-a"); seedSchool(db, "school-b", "admin-b");
    auth.users.set("admin-a", { customClaims: { role: "school_admin", schoolId: "school-a" } });
    auth.users.set("admin-b", { customClaims: { role: "school_admin", schoolId: "school-b" } });
    bucket.files.add("valves/school-a/year/publication/file.pdf"); bucket.files.add("schools/school-a/correspondences/c/file.pdf"); bucket.files.add("valves/school-b/year/publication/file.pdf");
    const report = await deleteSchoolCompletely({ db, auth, bucket, schoolId: "school-a", schoolData: { mainAdminId: "admin-a" }, actor: { uid: "super", email: "super@test" } });
    expect(report.status).toBe("complete");
    expect([...db.documents].filter(([path, value]) => !path.startsWith("platform/schoolDeletionLog/") && value.schoolId === "school-a")).toHaveLength(0);
    expect([...db.documents].some(([, value]) => value.schoolId === "school-b")).toBe(true);
    expect(db.documents.has("schools/school-a")).toBe(false);
    expect(db.documents.has("schools/school-b")).toBe(true);
    expect(auth.users.has("admin-a")).toBe(false); expect(auth.users.has("admin-b")).toBe(true);
    expect(bucket.files.has("valves/school-b/year/publication/file.pdf")).toBe(true);
    expect(db.order.at(-1)).toBe("delete:schools/school-a");
  });

  it("conserve un état récupérable puis réussit après un échec Auth", async () => {
    const db = new FakeDb(); const auth = new FakeAuth(); const bucket = new FakeBucket();
    seedSchool(db, "school-a", "admin-a");
    auth.users.set("admin-a", { customClaims: { role: "school_admin", schoolId: "school-a" } }); auth.failOnce.add("admin-a");
    await expect(deleteSchoolCompletely({ db, auth, bucket, schoolId: "school-a", schoolData: { mainAdminId: "admin-a" }, actor: { uid: "super" } })).rejects.toThrow("Suppression Auth incomplète");
    expect(db.documents.get("schools/school-a")?.status).toBe("deleting");
    await expect(deleteSchoolCompletely({ db, auth, bucket, schoolId: "school-a", schoolData: { mainAdminId: "admin-a" }, actor: { uid: "super" } })).resolves.toMatchObject({ status: "complete" });
  });

  it("protège les super admins et les comptes d'une autre école", async () => {
    const auth = new FakeAuth();
    auth.users.set("super", { customClaims: { role: "super_admin" } }); auth.users.set("other", { customClaims: { role: "secretary", schoolId: "school-b" } });
    const report = await deleteSchoolAuthUsers(auth, [{ uid: "super", sources: [], superAdmin: true }, { uid: "other", sources: [], superAdmin: false }], "school-a");
    expect(report.skipped).toBe(2); expect(auth.users.size).toBe(2);
  });
});
