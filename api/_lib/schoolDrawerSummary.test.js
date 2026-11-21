import { beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  forgetSchoolHistory, isMissingIndexError, readSchoolDrawerSummary, readSchoolHistoryPage, SCHOOL_HISTORY_INDEX,
  SCHOOL_HISTORY_PAGE_SIZE, summarizeSchoolDrawer,
} from "./schoolDrawerSummary.js";
import indexes from "../../firestore.indexes.json";

const kind = (value) => (value instanceof Timestamp ? "time" : typeof value);
const compare = (a, b) => (a instanceof Timestamp ? a.toMillis() - b.toMillis() || a.nanoseconds - b.nanoseconds : a < b ? -1 : a > b ? 1 : 0);

/**
 * Petite base en mémoire : filtres « == » et « >= » (même type seulement, comme Firestore), tri décroissant,
 * reprise après un repère, limite, projection des champs, et relevé des documents lus.
 * `indexed: false` imite Firestore sans l'index : toute requête triée est refusée (code 9).
 */
function fakeDb(collections, { indexed = true } = {}) {
  const reads = [];
  const query = (name, state = { filters: [], orders: [], fields: null, after: null, limit: null }) => ({
    where: (field, operator, value) => query(name, { ...state, filters: [...state.filters, [field, operator, value]] }),
    orderBy: (field, direction) => query(name, { ...state, orders: [...state.orders, [String(field), direction]] }),
    select: (...fields) => query(name, { ...state, fields }),
    startAfter: (...values) => query(name, { ...state, after: values }),
    limit: (count) => query(name, { ...state, limit: count }),
    get: async () => {
      if (state.orders.length && !indexed) throw Object.assign(new Error("9 FAILED_PRECONDITION: The query requires an index."), { code: 9 });
      let rows = (collections[name] ?? []).filter((row) => state.filters.every(([field, operator, value]) => (operator === "=="
        ? row[field] === value
        : kind(row[field]) === kind(value) && compare(row[field], value) >= 0)));
      if (state.orders.length) {
        rows = [...rows].sort((a, b) => compare(b.createdAt, a.createdAt) || (b.id < a.id ? -1 : 1));
        if (state.after) {
          const [value, id] = state.after;
          rows = rows.filter((row) => compare(row.createdAt, value) < 0 || (compare(row.createdAt, value) === 0 && row.id < id));
        }
      }
      if (state.limit) rows = rows.slice(0, state.limit);
      reads.push({ name, count: rows.length, fields: state.fields, ordered: state.orders.length > 0 });
      const pick = (row) => (state.fields ? Object.fromEntries(state.fields.filter((field) => field in row).map((field) => [field, row[field]])) : row);
      return { docs: rows.map(({ id, ...row }) => ({ id, data: () => pick(row), get: (field) => row[field] })) };
    },
  });
  return { reads, collection: (name) => query(name) };
}

const school = "ecole-a";
const year = "annee-1";
const at = (index) => Date.UTC(2026, 10, 1, 0, index);
function base() {
  return {
    students: [
      { id: "s1", schoolId: school, schoolYearId: year, className: "1ère Primaire", option: "", status: "ACTIVE", nom: "Secret", parentId: "p2" },
      { id: "s2", schoolId: school, schoolYearId: year, className: "1ère Primaire", status: "ACTIVE" },
      { id: "s3", schoolId: school, schoolYearId: year, className: "4ème Humanité", option: "Scientifique", status: "ACTIVE" },
      { id: "s4", schoolId: school, schoolYearId: year, className: "4ème Humanité", option: "Scientifique", status: "ARCHIVED" },
      { id: "s5", schoolId: school, schoolYearId: "annee-0", className: "1ère Primaire", status: "ACTIVE" },
      { id: "s6", schoolId: "ecole-b", schoolYearId: year, className: "1ère Primaire", status: "ACTIVE" },
    ],
    parents: [
      { id: "p1", schoolId: school, studentIds: ["s3"], telephone: "secret" },
      { id: "p2", schoolId: school, studentIds: [] },
      { id: "p3", schoolId: school, studentIds: ["s5"] },
    ],
    users: [
      { id: "u1", schoolId: school, role: "school_admin" },
      { id: "u2", schoolId: school, role: "school_admin", removedAt: "2026-01-01" },
      { id: "u3", schoolId: school, role: "parent", activeSchoolYearId: year },
      { id: "u4", schoolId: school, role: "teacher" },
      { id: "u5", schoolId: school, role: "cashier", activeSchoolYearId: "annee-0" },
    ],
    // 23 lignes : dates en texte (lignes paires) et horodatages du serveur (lignes impaires), une connexion,
    // et une ligne d'une autre année.
    auditLogs: [
      ...Array.from({ length: 23 }, (_, index) => ({
        id: `l${String(index).padStart(2, "0")}`, schoolId: school, schoolYearId: year,
        action: index === 5 ? "Connexion de l'administrateur" : `Action ${index}`, actorName: "SA",
        createdAt: index % 2 ? Timestamp.fromMillis(at(index)) : new Date(at(index)).toISOString(),
        metadata: { secret: true },
      })),
      { id: "autre", schoolId: school, schoolYearId: "annee-0", action: "Autre année", actorName: "SA", createdAt: new Date(at(99)).toISOString() },
    ],
  };
}

describe("lot SA-4 : nombres du drawer calculés par le serveur", () => {
  it("mêmes règles que l'écran : élèves de l'année, parents liés, comptes non retirés, élèves archivés hors répartition", () => {
    const summary = summarizeSchoolDrawer({ ...base(), students: base().students.filter((item) => item.schoolId === school && item.schoolYearId === year), schoolYearId: year });
    expect(summary).toEqual({
      students: 4,
      parents: 2,
      admins: 1,
      users: 2,
      classes: [
        { className: "1ère Primaire", option: "", count: 2 },
        { className: "4ème Humanité", option: "Scientifique", count: 1 },
      ],
    });
  });

  it("lit seulement l'école et l'année demandées, et seulement les champs utiles", async () => {
    const db = fakeDb(base());
    const summary = await readSchoolDrawerSummary(db, school, year);
    expect(summary.students).toBe(4);
    expect(summary.parents).toBe(2);
    expect(db.reads.map((read) => read.name).sort()).toEqual(["parents", "students", "users"]);
    expect(db.reads.every((read) => Array.isArray(read.fields))).toBe(true);
    // Aucune donnée personnelle dans la réponse : seulement des nombres et des noms de classes.
    expect(JSON.stringify(summary)).not.toMatch(/Secret|secret|s1|p1/);
  });
});

/** Toutes les pages, en suivant les repères donnés par le serveur. */
async function allPages(db, options) {
  const pages = [];
  let cursor = null;
  do {
    const page = await readSchoolHistoryPage(db, school, year, cursor, options);
    pages.push(page);
    cursor = page.cursor;
  } while (cursor && pages.length < 10);
  return pages;
}

describe("lot SA-4 : historique de l'école page par page, avec l'index", () => {
  beforeEach(() => forgetSchoolHistory());

  it("première page : les 10 lignes les plus récentes, deux formats de date mêlés, sans connexion ni autre année", async () => {
    const db = fakeDb(base());
    const page = await readSchoolHistoryPage(db, school, year);
    expect(page.mode).toBe("index");
    expect(page.logs).toHaveLength(SCHOOL_HISTORY_PAGE_SIZE);
    expect(page.logs.map((log) => log.action).slice(0, 3)).toEqual(["Action 22", "Action 21", "Action 20"]);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toMatch(/^i:/);
    expect(Object.keys(page.logs[0]).sort()).toEqual(["action", "actorName", "createdAt", "id", "schoolYearId"]);
  });

  it("toutes les pages : chaque ligne une seule fois, dans l'ordre, et la dernière page sans repère", async () => {
    const db = fakeDb(base());
    const pages = await allPages(db);
    const actions = pages.flatMap((page) => page.logs.map((log) => log.action));
    const expected = Array.from({ length: 23 }, (_, index) => 22 - index).filter((index) => index !== 5).map((index) => `Action ${index}`);
    expect(actions).toEqual(expected);
    expect(pages.map((page) => page.logs.length)).toEqual([10, 10, 2]);
    expect(pages.at(-1)).toMatchObject({ hasMore: false, cursor: null });
    expect(db.reads.every((read) => read.ordered && read.fields)).toBe(true);
  });

  it("lit seulement la page demandée, même avec un long journal", async () => {
    const data = base();
    data.auditLogs = Array.from({ length: 500 }, (_, index) => ({ id: `x${String(index).padStart(3, "0")}`, schoolId: school, schoolYearId: year, action: `Ligne ${index}`, actorName: "SA", createdAt: Timestamp.fromMillis(at(index)) }));
    const db = fakeDb(data);
    const meter = { reads: 0 };
    const first = await readSchoolHistoryPage(db, school, year, null, { meter });
    expect(first.logs[0].action).toBe("Ligne 499");
    expect(meter.reads).toBeLessThanOrEqual(2 * (SCHOOL_HISTORY_PAGE_SIZE + 3));
    const second = await readSchoolHistoryPage(db, school, year, first.cursor, { meter });
    expect(second.logs[0].action).toBe("Ligne 489");
    expect(meter.reads).toBeLessThanOrEqual(4 * (SCHOOL_HISTORY_PAGE_SIZE + 3));
  });

  it("refuse un repère mal formé", async () => {
    const db = fakeDb(base());
    for (const cursor of ["x", "i:pasdujson", `i:${Buffer.from(JSON.stringify({ s: [1], t: null })).toString("base64url")}`]) {
      await expect(readSchoolHistoryPage(db, school, year, cursor)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("l'index déclaré dans firestore.indexes.json est exactement celui demandé par la requête", () => {
    const declared = indexes.indexes.filter((index) => index.collectionGroup === "auditLogs");
    expect(declared).toContainEqual({ collectionGroup: SCHOOL_HISTORY_INDEX.collectionGroup, queryScope: SCHOOL_HISTORY_INDEX.queryScope, fields: SCHOOL_HISTORY_INDEX.fields });
  });
});

describe("lot SA-4 : historique sans l'index (repli, tant qu'il n'est pas installé)", () => {
  beforeEach(() => forgetSchoolHistory());

  it("reconnaît le refus de Firestore faute d'index", () => {
    expect(isMissingIndexError({ code: 9 })).toBe(true);
    expect(isMissingIndexError(new Error("FAILED_PRECONDITION: The query requires an index"))).toBe(true);
    expect(isMissingIndexError({ code: 7 })).toBe(false);
  });

  it("même résultat qu'avec l'index ; « Voir plus » ne relit pas le journal pendant 2 minutes", async () => {
    const db = fakeDb(base(), { indexed: false });
    const now = Date.UTC(2026, 10, 21, 10);
    const pages = await allPages(db, { now });
    expect(pages.map((page) => page.mode)).toEqual(["memory", "memory", "memory"]);
    expect(pages.flatMap((page) => page.logs.map((log) => log.action))).toEqual((await allPages(fakeDb(base()))).flatMap((page) => page.logs.map((log) => log.action)));
    expect(db.reads.filter((read) => !read.ordered)).toHaveLength(1);
    await readSchoolHistoryPage(db, school, year, "m:1", { now: now + 3 * 60_000 });
    expect(db.reads.filter((read) => !read.ordered)).toHaveLength(2);
  });

  it("une autre erreur de Firestore n'est pas cachée", async () => {
    const db = { collection: () => { throw Object.assign(new Error("indisponible"), { code: 14 }); } };
    await expect(readSchoolHistoryPage(db, school, year)).rejects.toMatchObject({ code: 14 });
  });
});
