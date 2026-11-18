import { describe, expect, it } from "vitest";
import { computeSchoolCounts, isPlatformStatsFresh, PLATFORM_STATS_PATH, readPlatformStats, refreshPlatformSchoolCounts } from "./platformStats.js";

/** Petite base en mémoire : collections, filtres « == », comptages et documents. */
function fakeDb(collections, { failCounts = false } = {}) {
  const docs = new Map();
  const counts = { n: 0 };
  const query = (name, filters = []) => ({
    where: (field, operator, value) => query(name, [...filters, [field, operator, value]]),
    count: () => ({
      get: async () => {
        counts.n += 1;
        if (failCounts) throw new Error("comptage indisponible");
        const rows = (collections[name] ?? []).filter((row) => filters.every(([field, , value]) => row[field] === value));
        return { data: () => ({ count: rows.length }) };
      },
    }),
  });
  return {
    counts,
    docs,
    collection: (name) => query(name),
    doc: (path) => ({
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: async (value, options) => { docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value); },
    }),
  };
}

const schools = [
  { status: "active" }, { status: "active" }, { status: "suspended" },
  { status: "inactive" }, { status: "pending" }, { status: "deleted" }, { status: "deleting" },
];
const base = {
  schools,
  students: [{}, {}, {}],
  parents: [{}],
  users: [{ role: "school_admin" }, { role: "school_admin" }, { role: "parent" }],
};

describe("statistiques du Dashboard Super administrateur", () => {
  it("ne compte pas les écoles supprimées ni en cours de suppression", async () => {
    expect(await computeSchoolCounts(fakeDb(base))).toEqual({ total: 5, active: 2, suspended: 1, pending: 1, inactive: 1 });
  });

  it("calcule une première fois, puis sert les chiffres gardés sans tout recompter", async () => {
    const db = fakeDb(base);
    const now = new Date("2026-11-19T10:00:00.000Z");
    const first = await readPlatformStats(db, { now });
    expect(first).toMatchObject({ students: 3, parents: 1, admins: 2, computedAt: now.toISOString() });
    expect(first.schools.total).toBe(5);
    const countsAfterFirst = db.counts.n;
    const second = await readPlatformStats(db, { now: new Date("2026-11-19T10:05:00.000Z") });
    expect(second).toEqual(first);
    expect(db.counts.n).toBe(countsAfterFirst);
  });

  it("recalcule après 10 minutes", async () => {
    const db = fakeDb(base);
    await readPlatformStats(db, { now: new Date("2026-11-19T10:00:00.000Z") });
    const before = db.counts.n;
    const later = await readPlatformStats(db, { now: new Date("2026-11-19T10:11:00.000Z") });
    expect(db.counts.n).toBeGreaterThan(before);
    expect(later.computedAt).toBe("2026-11-19T10:11:00.000Z");
  });

  it("« Actualiser » recalcule, mais pas deux fois en moins de 30 secondes", async () => {
    const db = fakeDb(base);
    await readPlatformStats(db, { now: new Date("2026-11-19T10:00:00.000Z") });
    const before = db.counts.n;
    await readPlatformStats(db, { force: true, now: new Date("2026-11-19T10:00:10.000Z") });
    expect(db.counts.n).toBe(before);
    await readPlatformStats(db, { force: true, now: new Date("2026-11-19T10:01:00.000Z") });
    expect(db.counts.n).toBeGreaterThan(before);
  });

  it("met à jour les écoles tout de suite après une suspension", async () => {
    const db = fakeDb(base);
    await readPlatformStats(db, { now: new Date("2026-11-19T10:00:00.000Z") });
    base.schools[0].status = "suspended";
    try {
      expect(await refreshPlatformSchoolCounts(db, new Date("2026-11-19T10:01:00.000Z"))).toBe(true);
      const stats = await readPlatformStats(db, { now: new Date("2026-11-19T10:02:00.000Z") });
      expect(stats.schools).toMatchObject({ total: 5, active: 1, suspended: 2 });
      expect(stats.schoolsComputedAt).toBe("2026-11-19T10:01:00.000Z");
    } finally {
      base.schools[0].status = "active";
    }
  });

  it("si le recomptage échoue, les chiffres gardés sont marqués périmés (jamais servis faux)", async () => {
    const db = fakeDb(base);
    await readPlatformStats(db, { now: new Date("2026-11-19T10:00:00.000Z") });
    const broken = { ...fakeDb(base, { failCounts: true }), docs: db.docs, doc: db.doc };
    expect(await refreshPlatformSchoolCounts(broken)).toBe(false);
    expect(db.docs.get(PLATFORM_STATS_PATH).stale).toBe(true);
    expect(isPlatformStatsFresh(db.docs.get(PLATFORM_STATS_PATH), Date.parse("2026-11-19T10:01:00.000Z"))).toBe(false);
  });

  it("refuse des chiffres incomplets ou venant du futur", () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const good = { schools: { total: 1, active: 1, suspended: 0, pending: 0, inactive: 0 }, students: 0, parents: 0, admins: 0, computedAt: "2026-11-19T09:59:00.000Z" };
    expect(isPlatformStatsFresh(good, now)).toBe(true);
    expect(isPlatformStatsFresh({ ...good, students: -1 }, now)).toBe(false);
    expect(isPlatformStatsFresh({ ...good, schools: { total: 1 } }, now)).toBe(false);
    expect(isPlatformStatsFresh({ ...good, computedAt: "2026-11-19T11:00:00.000Z" }, now)).toBe(false);
  });
});
