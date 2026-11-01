import { describe, expect, it } from "vitest";
import { listSectionSchoolRecords, loadSectionSchoolBootstrap } from "./sectionSchoolRecords.js";

const caller = { uid: "actor", role: "primary_admin", schoolId: "a" };
function fixture() {
  const rows = new Map<string, Record<string, unknown>>([
    ["users/actor", { ...caller, status: "active", sectionIds: ["Primaire"] }],
    ["schools/a", { status: "active" }], ["schoolYears/y", { schoolId: "a" }],
    ["students/one", { schoolId: "a", schoolYearId: "y", section: "Primaire" }],
    ["students/other", { schoolId: "a", schoolYearId: "y", section: "Secondaire" }],
    ["students/foreign", { schoolId: "b", schoolYearId: "y", section: "Primaire" }],
    ["students/legacy", { schoolId: "a", schoolYearId: "y", className: "1ère Primaire" }],
    ["classes/one::a", { schoolId: "a", schoolYearId: "y", section: "Primaire" }],
  ]);
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, exists: rows.has(path), data: () => rows.get(path)! });
  type Filter = [string, string, unknown];
  const reads: Array<{ name: string; filters: Filter[] }> = [];
  function query(name: string, filters: Filter[] = [], after = "", count = 101) {
    return {
      where: (field: string, op: string, value: unknown): ReturnType<typeof query> => query(name, [...filters, [field, op, value]], after, count),
      orderBy: (): ReturnType<typeof query> => query(name, filters, after, count),
      startAfter: (record: { id: string }): ReturnType<typeof query> => query(name, filters, record.id, count),
      limit: (limit: number): ReturnType<typeof query> => query(name, filters, after, limit),
      get: async () => {
        reads.push({ name, filters });
        return { docs: [...rows].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/")[1] > after
          && filters.every(([field, op, value]) => op === "in" ? (value as unknown[]).includes(data[field]) : data[field] === value))
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, count).map(([path]) => snapshot(path)) };
      },
    };
  }
  const db = { doc: (path: string) => ({ path }), collection: (name: string) => query(name),
    runTransaction: async <T>(run: (tx: { get: (ref: { path: string } | ReturnType<typeof query>) => Promise<unknown> }) => Promise<T>) =>
      run({ get: async (ref) => "path" in ref ? snapshot(ref.path) : ref.get() }) };
  return { db, rows, reads };
}
const body = { action: "list-section-school-records", kind: "students", schoolYearId: "y" };

describe("lecture scolaire transactionnelle bornée", () => {
  it("lit les définitions de frais de l'année sans leur inventer de section", async () => {
    const { db, rows, reads } = fixture();
    rows.set("feeTypes/fee", { schoolId: "a", schoolYearId: "y", amount: 10 });
    rows.set("feeTypes/foreign", { schoolId: "b", schoolYearId: "y", amount: 20 });
    const result = await listSectionSchoolRecords({ db, caller, body: { ...body, kind: "feeTypes" } });
    expect(result.items).toEqual([{ id: "fee", schoolId: "a", schoolYearId: "y", amount: 10 }]);
    expect(reads[0].filters).toEqual([["schoolId", "==", "a"], ["schoolYearId", "==", "y"]]);
  });
  it("charge uniquement le propre profil et les références publiques de son école", async () => {
    const { db, rows, reads } = fixture();
    rows.set("schools/a", { status: "active", name: "Fictive", privateMetadata: "excluded" });
    rows.set("users/other", { schoolId: "a", role: "parent" });
    rows.set("schoolYears/foreign", { schoolId: "b" });
    const result = await loadSectionSchoolBootstrap({ db, caller, body: { action: "load-section-school-bootstrap" } });
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({ id: "actor", role: "primary_admin", sectionIds: ["Primaire"] });
    expect(result.schools).toEqual([{ id: "a", name: "Fictive", status: "active" }]);
    expect(result.schoolYears.map((year: { id: string }) => year.id)).toEqual(["y"]);
    expect(reads).toEqual([{ name: "schoolYears", filters: [["schoolId", "==", "a"]] }]);
  });
  it("refuse le bootstrap désactivé et toute école demandée par le client", async () => {
    const { db, rows } = fixture();
    await expect(loadSectionSchoolBootstrap({ db, caller, body: { action: "load-section-school-bootstrap", schoolId: "b" } })).rejects.toMatchObject({ statusCode: 400 });
    rows.set("users/actor", { ...rows.get("users/actor"), active: false });
    await expect(loadSectionSchoolBootstrap({ db, caller, body: { action: "load-section-school-bootstrap" } })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("borne la requête avant lecture et n'infère pas une section historique", async () => {
    const { db, reads } = fixture();
    const result = await listSectionSchoolRecords({ db, caller, body });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["one"]);
    expect(reads).toEqual([{ name: "students", filters: [["schoolId", "==", "a"], ["schoolYearId", "==", "y"], ["section", "in", ["Primaire"]]] }]);
  });
  it("accepte les anciens identifiants de classe avec séparateur d'option", async () => {
    const { db } = fixture();
    await expect(listSectionSchoolRecords({ db, caller, body: { ...body, kind: "classes", cursorId: "one::a" } })).resolves.toMatchObject({ items: [] });
  });
  it.each(["other", "foreign", "missing"])("refuse le curseur non autorisé %s", async (cursorId) => {
    const { db, reads } = fixture();
    await expect(listSectionSchoolRecords({ db, caller, body: { ...body, cursorId } })).rejects.toMatchObject({ statusCode: 403 });
    expect(reads).toEqual([]);
  });
  it.each([{ status: "inactive" }, { active: false }, { sectionIds: [] }, { schoolId: "b" }, { role: "school_admin" }])("refuse un profil invalide avant lecture", async (patch) => {
    const { db, rows, reads } = fixture();
    rows.set("users/actor", { ...rows.get("users/actor"), ...patch });
    await expect(listSectionSchoolRecords({ db, caller, body })).rejects.toMatchObject({ statusCode: 403 });
    expect(reads).toEqual([]);
  });
  it("refuse une école suspendue et une année étrangère", async () => {
    const { db, rows } = fixture();
    rows.set("schools/a", { status: "suspended" });
    await expect(listSectionSchoolRecords({ db, caller, body })).rejects.toMatchObject({ statusCode: 403 });
    rows.set("schools/a", { status: "active" }); rows.set("schoolYears/y", { schoolId: "b" });
    await expect(listSectionSchoolRecords({ db, caller, body })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("pagine sans perte ni doublon", async () => {
    const { db, rows } = fixture();
    for (let i = 0; i < 105; i++) rows.set(`students/p${String(i).padStart(3, "0")}`, { schoolId: "a", schoolYearId: "y", section: "Primaire" });
    const first = await listSectionSchoolRecords({ db, caller, body });
    const second = await listSectionSchoolRecords({ db, caller, body: { ...body, cursorId: first.nextCursorId } });
    expect(first.items).toHaveLength(100); expect(second.items).toHaveLength(6);
    expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(106);
    expect(second.nextCursorId).toBeNull();
  });
  it("n'accepte ni parent, ni filtre de section fourni par le client", async () => {
    const { db } = fixture();
    for (const extra of [{ kind: "parents" }, { section: "Secondaire" }, { cursorId: "../other" }]) {
      await expect(listSectionSchoolRecords({ db, caller, body: { ...body, ...extra } })).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});
