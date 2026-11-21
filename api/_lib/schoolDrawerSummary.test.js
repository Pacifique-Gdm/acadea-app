import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetSchoolHistory, readSchoolDrawerSummary, readSchoolHistoryPage, SCHOOL_HISTORY_PAGE_SIZE, summarizeSchoolDrawer,
} from "./schoolDrawerSummary.js";

/** Petite base en mémoire : filtres « == », projection des champs, et relevé des documents lus par collection. */
function fakeDb(collections) {
  const reads = [];
  const query = (name, filters = [], fields = null) => ({
    where: (field, _operator, value) => query(name, [...filters, [field, value]], fields),
    select: (...selected) => query(name, filters, selected),
    get: async () => {
      const rows = (collections[name] ?? []).filter((row) => filters.every(([field, value]) => row[field] === value));
      reads.push({ name, count: rows.length, fields });
      return {
        docs: rows.map(({ id, ...row }) => ({
          id,
          data: () => (fields ? Object.fromEntries(fields.filter((field) => field in row).map((field) => [field, row[field]])) : row),
        })),
      };
    },
  });
  return { reads, collection: (name) => query(name) };
}

const school = "ecole-a";
const year = "annee-1";
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
    auditLogs: Array.from({ length: 23 }, (_, index) => ({
      id: `l${String(index).padStart(2, "0")}`, schoolId: school, schoolYearId: year,
      action: index === 5 ? "Connexion de l'administrateur" : `Action ${index}`, actorName: "SA",
      createdAt: index % 2 ? { toMillis: () => Date.UTC(2026, 10, 1, 0, index) } : new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      metadata: { secret: true },
    })),
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

describe("lot SA-4 : historique de l'école page par page", () => {
  beforeEach(() => forgetSchoolHistory());

  it("première page : les 10 lignes les plus récentes, sans connexion, avec le nombre total", async () => {
    const db = fakeDb(base());
    const page = await readSchoolHistoryPage(db, school, year, 0);
    expect(page.logs).toHaveLength(SCHOOL_HISTORY_PAGE_SIZE);
    expect(page.logs[0].action).toBe("Action 22");
    expect(page.logs.map((log) => log.action)).not.toContain("Connexion de l'administrateur");
    expect(page).toMatchObject({ page: 0, total: 22, hasMore: true });
    expect(Object.keys(page.logs[0]).sort()).toEqual(["action", "actorName", "createdAt", "id", "schoolYearId"]);
  });

  it("« Voir plus » ne relit pas le journal pendant 2 minutes ; la dernière page dit qu'il n'y a plus rien", async () => {
    const db = fakeDb(base());
    const now = Date.UTC(2026, 10, 21, 10);
    await readSchoolHistoryPage(db, school, year, 0, { now });
    const second = await readSchoolHistoryPage(db, school, year, 1, { now: now + 1_000 });
    const third = await readSchoolHistoryPage(db, school, year, 2, { now: now + 2_000 });
    expect(db.reads.filter((read) => read.name === "auditLogs")).toHaveLength(1);
    expect(second.logs[0].action).toBe("Action 12");
    expect(third).toMatchObject({ page: 2, hasMore: false });
    expect(third.logs).toHaveLength(2);
    await readSchoolHistoryPage(db, school, year, 1, { now: now + 3 * 60_000 });
    expect(db.reads.filter((read) => read.name === "auditLogs")).toHaveLength(2);
  });
});
