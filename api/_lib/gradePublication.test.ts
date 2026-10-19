import { describe, expect, it } from "vitest";
import { executeGradePublication } from "./gradePublication.js";

type Row = { id: string; [key: string]: unknown };

function fixture() {
  const records: Record<string, Row[]> = {
    schools: [{ id: "s", status: "active", activeSchoolYearId: "y", currency: "CDF" }],
    schoolYears: [{ id: "y", schoolId: "s", name: "2027-2028", status: "active", currency: "CDF" }],
    users: [
      { id: "director", role: "study_director", schoolId: "s", active: true },
      { id: "parent-user", role: "parent", schoolId: "s", parentId: "parent", active: true },
      { id: "other-parent", role: "parent", schoolId: "s", parentId: "other", active: true },
    ],
    classes: [{ id: "class", schoolId: "s", schoolYearId: "y", name: "4ème Humanité", active: true }],
    students: [{ id: "student", schoolId: "s", schoolYearId: "y", classId: "class", className: "4ème Humanité", status: "ACTIVE", nom: "Test", postnom: "", prenom: "Aline" }],
    subjects: [{ id: "math", schoolId: "s", schoolYearId: "y", name: "Mathématiques" }],
    pedagogicalAssignments: [{ id: "assignment", schoolId: "s", schoolYearId: "y", classId: "class", subjectId: "math", teacherId: "teacher", active: true }],
    courseGradingConfigs: [{ id: "config", schoolId: "s", schoolYearId: "y", classId: "class", subjectId: "math", gradingSlot: "period_1", maxScore: 20 }],
    gradeEntries: [{ id: "grade", schoolId: "s", schoolYearId: "y", classId: "class", subjectId: "math", studentId: "student", gradingSlot: "period_1", status: "graded", score: 12, maxScoreSnapshot: 20 }],
    parents: [{ id: "parent", schoolId: "s", schoolYearId: "y", studentIds: ["student"], status: "active" }, { id: "other", schoolId: "s", schoolYearId: "y", studentIds: [], status: "active" }],
    feeTypes: [{ id: "minerval", schoolId: "s", schoolYearId: "y", name: "Minerval" }],
    payments: [{ id: "payment", schoolId: "s", schoolYearId: "y", studentId: "student", feeTypeId: "minerval", amount: 150000, currency: "CDF" }],
    gradePublicationRuns: [], publishedGradeResults: [], notifications: [],
  };
  const writes: string[] = [];
  const getRow = (path: string) => { const [collection, id] = path.split("/"); return records[collection]?.find((item) => item.id === id); };
  const snapshot = (row: Row | undefined) => ({ id: row?.id, exists: Boolean(row), data: () => row });
  const write = (path: string, row: Row, merge = false) => {
    const [collection, id] = path.split("/");
    const index = records[collection].findIndex((item) => item.id === id);
    if (index < 0) records[collection].push({ ...row, id });
    else records[collection][index] = merge ? { ...records[collection][index], ...row } : { ...row, id };
    writes.push(path);
  };
  const db = {
    doc: (path: string) => ({ path, get: async () => snapshot(getRow(path)) }),
    collection: (collection: string) => {
      const query = (conditions: Array<[string, string, unknown]>): unknown => ({
        where: (field: string, op: string, value: unknown) => query([...conditions, [field, op, value]]),
        limit: () => query(conditions),
        get: async () => ({ docs: (records[collection] ?? []).filter((row) => conditions.every(([field, op, value]) =>
          op === "in" ? (value as unknown[]).includes(row[field]) : op === "array-contains" ? Array.isArray(row[field]) && row[field].includes(value) : row[field] === value)).map(snapshot) }),
      });
      return query([]);
    },
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      const queued: Array<() => void> = [];
      const transaction = {
        get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
        create: (ref: { path: string }, row: Row) => queued.push(() => write(ref.path, row)),
        set: (ref: { path: string }, row: Row) => queued.push(() => write(ref.path, row)),
        update: (ref: { path: string }, row: Row) => queued.push(() => write(ref.path, row, true)),
      };
      const result = await callback(transaction);
      queued.forEach((operation) => operation());
      return result;
    },
  };
  return { db, records, writes };
}

const director = { uid: "director", role: "study_director", schoolId: "s" };
const parent = { uid: "parent-user", role: "parent", schoolId: "s" };
const base = { schoolId: "s", schoolYearId: "y" };
const publish = { ...base, action: "grades-publish", classId: "class", slot: "period_1", requestId: "request_1234567890", percentage: { operator: "gte", value: 60 }, fee: { feeTypeId: "minerval", operator: "gte", amountMinor: 15000000 } };

describe("publication serveur des cotes", () => {
  it("écrit droits et notifications atomiquement, sans autres périodes ni informations financières", async () => {
    const { db, records, writes } = fixture();
    records.users.push({ id: "foreign-parent", role: "parent", schoolId: "other", parentId: "parent", active: true });
    const result = await executeGradePublication({ db, caller: director, body: publish });
    expect(result).toMatchObject({ ok: true, publishedCount: 1, notificationCount: 1, repeated: false });
    expect(records.publishedGradeResults).toHaveLength(1);
    expect(records.publishedGradeResults[0].result).toMatchObject({ percentage: 60, rank: 1, courses: [{ score: 12, maximum: 20 }] });
    expect(records.notifications[0].recipientUserId).toBe("parent-user");
    expect(records.notifications[0].body).not.toMatch(/150.?000|60\s*%/);
    const afterFirst = writes.length;
    expect(await executeGradePublication({ db, caller: director, body: publish })).toMatchObject({ repeated: true, publishedCount: 1 });
    expect(writes).toHaveLength(afterFirst);
    const list = await executeGradePublication({ db, caller: parent, body: { ...base, action: "grades-parent-list" } });
    expect(list.children).toHaveLength(1);
    expect(list.children[0].publications.map((item: { slot: string }) => item.slot)).toEqual(["period_1"]);
    const own = await executeGradePublication({ db, caller: parent, body: { ...base, action: "grades-parent-read", studentId: "student", slot: "period_1" } });
    expect(own.result.studentId).toBe("student");
    expect(own.result).not.toHaveProperty("recipients");
    expect(own.result).not.toHaveProperty("publishedBy");
    await expect(executeGradePublication({ db, caller: parent, body: { ...base, action: "grades-parent-read", studentId: "student", slot: "period_2" } })).rejects.toMatchObject({ status: 404 });
    await expect(executeGradePublication({ db, caller: { uid: "other-parent", role: "parent", schoolId: "s" }, body: { ...base, action: "grades-parent-read", studentId: "student", slot: "period_1" } })).rejects.toMatchObject({ status: 403 });
    records.parents[0].studentIds = [];
    await expect(executeGradePublication({ db, caller: parent, body: { ...base, action: "grades-parent-read", studentId: "student", slot: "period_1" } })).rejects.toMatchObject({ status: 403 });
  });

  it("refuse la publication en année archivée et en cas de devise incohérente", async () => {
    const { db, records, writes } = fixture();
    records.schoolYears[0].status = "archived";
    await expect(executeGradePublication({ db, caller: director, body: publish })).rejects.toMatchObject({ status: 403 });
    records.schoolYears[0].status = "active";
    records.payments[0].currency = "USD";
    await expect(executeGradePublication({ db, caller: director, body: publish })).rejects.toMatchObject({ status: 409 });
    expect(writes).toHaveLength(0);
  });

  it("retire atomiquement l'accès sans exposer une ancienne fiche", async () => {
    const { db } = fixture();
    const result = await executeGradePublication({ db, caller: director, body: publish });
    await expect(executeGradePublication({ db, caller: director, body: { ...base, action: "grades-withdraw", publicationId: result.publicationId } })).resolves.toMatchObject({ withdrawn: true });
    await expect(executeGradePublication({ db, caller: parent, body: { ...base, action: "grades-parent-read", studentId: "student", slot: "period_1" } })).rejects.toMatchObject({ status: 404 });
  });

  it("n'empêche pas la lecture courante lorsqu'un parent conserve aussi un lien historique", async () => {
    const { db, records } = fixture();
    await executeGradePublication({ db, caller: director, body: publish });
    records.students.push({ id: "historical-child", schoolId: "s", schoolYearId: "previous-year", nom: "Archive" });
    records.parents[0].studentIds = ["student", "historical-child"];
    const result = await executeGradePublication({ db, caller: parent, body: { ...base, action: "grades-parent-list" } });
    expect(result.children.map((child: { studentId: string }) => child.studentId)).toEqual(["student"]);
    await expect(executeGradePublication({ db, caller: parent, body: { ...base, action: "grades-parent-read", studentId: "historical-child", slot: "period_1" } })).rejects.toMatchObject({ status: 403 });
  });
});
