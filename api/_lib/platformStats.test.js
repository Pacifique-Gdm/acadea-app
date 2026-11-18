import { describe, expect, it } from "vitest";
import { computeSchoolCounts, isPlatformStatsFresh, PLATFORM_STATS_PATH, readPlatformStats } from "./platformStats.js";

/** Petite base en mémoire : collections, filtres « == », comptages (notés par collection) et documents. */
function fakeDb(collections) {
  const docs = new Map();
  const counted = [];
  const query = (name, filters = []) => ({
    where: (field, operator, value) => query(name, [...filters, [field, operator, value]]),
    count: () => ({
      get: async () => {
        counted.push(name);
        const rows = (collections[name] ?? []).filter((row) => filters.every(([field, , value]) => row[field] === value));
        return { data: () => ({ count: rows.length }) };
      },
    }),
  });
  return {
    counted,
    docs,
    collection: (name) => query(name),
    doc: (path) => ({
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: async (value, options) => { docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value); },
    }),
  };
}

function base() {
  return {
    schools: [
      { status: "active" }, { status: "active" }, { status: "suspended" },
      { status: "inactive" }, { status: "pending" }, { status: "deleted" }, { status: "deleting" },
    ],
    students: [{}, {}, {}],
    parents: [{}],
    users: [{ role: "school_admin" }, { role: "school_admin" }, { role: "parent" }],
  };
}
const at = (time) => new Date(`2026-11-19T${time}.000Z`);
const expensive = (db) => db.counted.filter((name) => name === "students" || name === "parents").length;

describe("lot SA-3 : statistiques du Dashboard Super administrateur", () => {
  it("ne compte pas les écoles supprimées ni en cours de suppression", async () => {
    expect(await computeSchoolCounts(fakeDb(base()))).toEqual({ total: 5, active: 2, suspended: 1, pending: 1, inactive: 1 });
  });

  it("calcule une première fois et garde les élèves et parents dans platform/stats", async () => {
    const db = fakeDb(base());
    const stats = await readPlatformStats(db, { now: at("10:00:00") });
    expect(stats).toEqual({
      schools: { total: 5, active: 2, suspended: 1, pending: 1, inactive: 1 },
      students: 3, parents: 1, admins: 2,
      computedAt: "2026-11-19T10:00:00.000Z", schoolsComputedAt: "2026-11-19T10:00:00.000Z",
    });
    expect(db.docs.get(PLATFORM_STATS_PATH)).toMatchObject({ students: 3, parents: 1, stale: false });
  });

  it("écoles et administrateurs toujours recomptés : un changement direct dans la base se voit tout de suite", async () => {
    const data = base();
    const db = fakeDb(data);
    await readPlatformStats(db, { now: at("10:00:00") });
    // Changements faits hors de l'application (script, essai) : 2 écoles fictives ajoutées puis une effacée.
    data.schools.push({ status: "active" }, { status: "active" });
    data.users.push({ role: "school_admin" });
    let stats = await readPlatformStats(db, { now: at("10:01:00") });
    expect(stats.schools).toMatchObject({ total: 7, active: 4 });
    expect(stats.admins).toBe(3);
    data.schools.pop();
    stats = await readPlatformStats(db, { now: at("10:02:00") });
    expect(stats.schools).toMatchObject({ total: 6, active: 3 });
    expect(stats.schoolsComputedAt).toBe("2026-11-19T10:02:00.000Z");
  });

  it("élèves et parents gardés 10 minutes au plus, avec l'heure du calcul", async () => {
    const data = base();
    const db = fakeDb(data);
    await readPlatformStats(db, { now: at("10:00:00") });
    const afterFirst = expensive(db);
    data.students.push({});
    let stats = await readPlatformStats(db, { now: at("10:05:00") });
    expect(expensive(db)).toBe(afterFirst);
    expect(stats).toMatchObject({ students: 3, computedAt: "2026-11-19T10:00:00.000Z" });
    stats = await readPlatformStats(db, { now: at("10:11:00") });
    expect(expensive(db)).toBeGreaterThan(afterFirst);
    expect(stats).toMatchObject({ students: 4, computedAt: "2026-11-19T10:11:00.000Z" });
  });

  it("« Actualiser » recalcule élèves et parents, mais pas deux fois en moins de 30 secondes", async () => {
    const db = fakeDb(base());
    await readPlatformStats(db, { now: at("10:00:00") });
    const before = expensive(db);
    await readPlatformStats(db, { force: true, now: at("10:00:10") });
    expect(expensive(db)).toBe(before);
    await readPlatformStats(db, { force: true, now: at("10:01:00") });
    expect(expensive(db)).toBeGreaterThan(before);
  });

  it("des chiffres gardés marqués périmés sont recalculés", async () => {
    const db = fakeDb(base());
    await readPlatformStats(db, { now: at("10:00:00") });
    db.docs.set(PLATFORM_STATS_PATH, { ...db.docs.get(PLATFORM_STATS_PATH), stale: true });
    const before = expensive(db);
    await readPlatformStats(db, { now: at("10:01:00") });
    expect(expensive(db)).toBeGreaterThan(before);
  });

  it("refuse des chiffres gardés incomplets ou venant du futur", () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const good = { schools: { total: 1, active: 1, suspended: 0, pending: 0, inactive: 0 }, students: 0, parents: 0, admins: 0, computedAt: "2026-11-19T09:59:00.000Z" };
    expect(isPlatformStatsFresh(good, now)).toBe(true);
    expect(isPlatformStatsFresh({ ...good, students: -1 }, now)).toBe(false);
    expect(isPlatformStatsFresh({ ...good, schools: { total: 1 } }, now)).toBe(false);
    expect(isPlatformStatsFresh({ ...good, computedAt: "2026-11-19T11:00:00.000Z" }, now)).toBe(false);
  });
});
