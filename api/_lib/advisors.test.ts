import { describe, expect, it } from "vitest";
import { allowedRecipientRoles } from "./messageRecipients.js";
import {
  computeAdvisorGrades, computeAdvisorOverview, computeAdvisorStudents, listAdvisorStudents, listClassVisits, loadAdvisorOverview,
  normalizeVisitInput, saveClassVisit, visibleVisits,
} from "./advisors.js";

// Petite base Firestore en mémoire : documents, requêtes where(==) et transactions simples.
function fakeDb(initial: Record<string, Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(initial));
  let counter = 0;
  const docRef = (path: string) => ({
    id: path.split("/").pop()!,
    path,
    get: async () => ({ exists: store.has(path), id: path.split("/").pop()!, data: () => store.get(path) }),
    set: async (value: Record<string, unknown>) => { store.set(path, value); },
  });
  const query = (name: string, filters: Array<[string, unknown]> = []) => ({
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
    get: async () => ({
      docs: [...store.entries()]
        .filter(([path]) => path.startsWith(`${name}/`) && path.split("/").length === 2)
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([path, data]) => ({ id: path.split("/")[1], data: () => data })),
    }),
    doc: (id?: string) => docRef(`${name}/${id ?? `auto${++counter}`}`),
  });
  return {
    store,
    doc: docRef,
    collection: (name: string) => query(name),
    runTransaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      get: (ref: ReturnType<typeof docRef>) => ref.get(),
      set: (ref: ReturnType<typeof docRef>, value: Record<string, unknown>) => { store.set(ref.path, value); },
    }),
  };
}

const school = { status: "active", schoolType: "Mixte" };
const base = () => ({
  "schools/s1": school,
  "schoolYears/y1": { schoolId: "s1", status: "active" },
  "users/adv": { role: "pedagogical_advisor", schoolId: "s1", name: "Conseiller A", sectionIds: ["Primaire"] },
  "users/adv2": { role: "pedagogical_advisor", schoolId: "s1", name: "Conseiller B" },
  "users/dir": { role: "study_director", schoolId: "s1", sectionIds: ["Secondaire"] },
  "users/adm": { role: "school_admin", schoolId: "s1" },
  "users/tch": { role: "teacher", schoolId: "s1" },
  "classes/cP": { schoolId: "s1", schoolYearId: "y1", name: "3ème Primaire", section: "Primaire" },
  "classes/cS": { schoolId: "s1", schoolYearId: "y1", name: "5ème A", section: "Secondaire" },
  "teachers/t1": { schoolId: "s1", schoolYearId: "y1", fullName: "M. Kabila", sectionIds: ["Primaire"] },
  "teachers/t2": { schoolId: "s1", schoolYearId: "y1", fullName: "Mme Secondaire", sectionIds: ["Secondaire"] },
  "subjects/m": { schoolId: "s1", schoolYearId: "y1", name: "Mathématiques" },
  "pedagogicalAssignments/a1": { schoolId: "s1", schoolYearId: "y1", teacherId: "t1", classId: "cP", subjectId: "m", weeklyPeriods: 4, active: true },
  "pedagogicalAssignments/a2": { schoolId: "s1", schoolYearId: "y1", teacherId: "t2", classId: "cS", subjectId: "m", weeklyPeriods: 3, active: true },
  "students/e1": { schoolId: "s1", schoolYearId: "y1", fullName: "Mukendi Jean", className: "3ème Primaire", section: "Primaire", matricule: "M1", balance: 50, payments: [1] },
  "students/e2": { schoolId: "s1", schoolYearId: "y1", fullName: "Kasa Paul", className: "5ème A", section: "Secondaire" },
});
const caller = (uid: string, role: string) => ({ uid, role, schoolId: "s1" });
const visit = { classId: "cP", teacherId: "t1", subjectId: "m", visitDate: "2026-11-20", strengths: "Bonne gestion", improvements: "", advice: "Varier les exercices", nextVisitDate: "2026-12-10" };

describe("Lot 10 — Conseiller pédagogique (serveur)", () => {
  it("règle unique des sections : un conseiller Primaire ne voit que le Primaire, sans section = toute l'école", async () => {
    const db = fakeDb(base());
    const limited = await loadAdvisorOverview({ db, caller: caller("adv", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1" } });
    expect(limited.sections).toEqual(["Primaire"]);
    expect(limited.teachers.map((item: { teacherName: string }) => item.teacherName)).toEqual(["M. Kabila"]);
    expect(limited.metrics).toMatchObject({ teachers: 1, assignments: 1, workload: 4 });
    const whole = await loadAdvisorOverview({ db, caller: caller("adv2", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1" } });
    expect(whole.sections).toEqual([]);
    expect(whole.metrics.teachers).toBe(2);
  });

  it("un compte qui couvre toutes les sections de l'école agit pour toute l'école", () => {
    const result = computeAdvisorOverview({ sections: [], teachers: [{ id: "t", fullName: "X", sectionIds: ["CTEB"] }], classes: [], subjects: [], assignments: [] });
    expect(result.teachers).toHaveLength(1);
  });

  it("élèves sans aucune donnée d'argent", async () => {
    const db = fakeDb(base());
    const result = await listAdvisorStudents({ db, caller: caller("adv", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1" } });
    expect(result.students).toEqual([{ id: "e1", name: "Mukendi Jean", matricule: "M1", className: "3ème Primaire", section: "Primaire", gender: "", status: "ACTIVE" }]);
    expect(JSON.stringify(result)).not.toMatch(/balance|payments/);
    expect(computeAdvisorStudents({ sections: [], students: [{ id: "x", fullName: "A", amountDue: 9 }] })[0]).not.toHaveProperty("amountDue");
  });

  it("refuse les autres rôles et les autres écoles", async () => {
    const db = fakeDb(base());
    await expect(loadAdvisorOverview({ db, caller: caller("tch", "teacher"), body: { schoolId: "s1", schoolYearId: "y1" } })).rejects.toMatchObject({ status: 403 });
    await expect(loadAdvisorOverview({ db, caller: { uid: "adv", role: "pedagogical_advisor", schoolId: "s2" }, body: { schoolId: "s1", schoolYearId: "y1" } })).rejects.toMatchObject({ status: 403 });
    await expect(listAdvisorStudents({ db, caller: caller("dir", "study_director"), body: { schoolId: "s1", schoolYearId: "y1" } })).rejects.toMatchObject({ status: 403 });
  });

  it("fiches de visite : le conseiller crée et modifie SES fiches, dans ses sections seulement", async () => {
    const db = fakeDb(base());
    const created = await saveClassVisit({ db, caller: caller("adv", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1", visit }, now: () => "2026-11-20T10:00:00.000Z" });
    expect(created.visit).toMatchObject({ className: "3ème Primaire", teacherName: "M. Kabila", subjectName: "Mathématiques", authorId: "adv", section: "Primaire" });
    const updated = await saveClassVisit({ db, caller: caller("adv", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1", visitId: created.visit.id, visit: { ...visit, advice: "Nouveau conseil" } } });
    expect(updated.visit.advice).toBe("Nouveau conseil");
    await expect(saveClassVisit({ db, caller: caller("adv2", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1", visitId: created.visit.id, visit } })).rejects.toMatchObject({ status: 403 });
    await expect(saveClassVisit({ db, caller: caller("adv", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1", visit: { ...visit, classId: "cS", teacherId: "", subjectId: "" } } })).rejects.toMatchObject({ status: 403 });
    await expect(saveClassVisit({ db, caller: caller("dir", "study_director"), body: { schoolId: "s1", schoolYearId: "y1", visit } })).rejects.toMatchObject({ status: 403 });
  });

  it("fiches de visite : refus sur une année archivée", async () => {
    const db = fakeDb({ ...base(), "schoolYears/y1": { schoolId: "s1", status: "archived" } });
    await expect(saveClassVisit({ db, caller: caller("adv", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1", visit } })).rejects.toMatchObject({ status: 409 });
  });

  it("fiches visibles : auteur, direction des études de la section, administrateur ; jamais un enseignant", async () => {
    const db = fakeDb(base());
    await saveClassVisit({ db, caller: caller("adv", "pedagogical_advisor"), body: { schoolId: "s1", schoolYearId: "y1", visit } });
    const body = { schoolId: "s1", schoolYearId: "y1" };
    expect((await listClassVisits({ db, caller: caller("adv", "pedagogical_advisor"), body })).visits).toHaveLength(1);
    expect((await listClassVisits({ db, caller: caller("adv2", "pedagogical_advisor"), body })).visits).toHaveLength(0);
    expect((await listClassVisits({ db, caller: caller("adm", "school_admin"), body })).visits).toHaveLength(1);
    // Directeur des études limité au Secondaire : la fiche du Primaire ne le concerne pas.
    expect((await listClassVisits({ db, caller: caller("dir", "study_director"), body })).visits).toHaveLength(0);
    await expect(listClassVisits({ db, caller: caller("tch", "teacher"), body })).rejects.toMatchObject({ status: 403 });
    expect(visibleVisits({ role: "study_director", uid: "x", sections: [], visits: [{ section: "Primaire" }] })).toHaveLength(1);
  });

  it("contrôle le contenu d'une fiche", () => {
    expect(() => normalizeVisitInput({ classId: "c", visitDate: "2026-11-20" })).toThrow(/au moins/);
    expect(() => normalizeVisitInput({ ...visit, visitDate: "20/11/2026" })).toThrow(/Date de la visite/);
    expect(() => normalizeVisitInput({ ...visit, strengths: "x".repeat(2001) })).toThrow(/2000/);
  });
  it("cotes en lecture : moyenne de la classe par période, classes des sections seulement", () => {
    const common = { schoolId: "s1", schoolYearId: "y1" };
    const result = computeAdvisorGrades({
      sections: ["Secondaire"],
      students: [
        { id: "e1", ...common, fullName: "A", className: "5ème A", classId: "cS", section: "Secondaire" },
        { id: "e2", ...common, fullName: "B", className: "5ème A", classId: "cS", section: "Secondaire" },
        { id: "e3", ...common, fullName: "C", className: "3ème Primaire", classId: "cP", section: "Primaire" },
      ],
      classes: [{ id: "cS", ...common, name: "5ème A", section: "Secondaire" }, { id: "cP", ...common, name: "3ème Primaire", section: "Primaire" }],
      subjects: [{ id: "m", ...common, name: "Maths" }],
      assignments: [{ id: "a", ...common, classId: "cS", subjectId: "m", teacherId: "t", active: true }, { id: "b", ...common, classId: "cP", subjectId: "m", teacherId: "t", active: true }],
      configs: [],
      entries: [
        { ...common, studentId: "e1", classId: "cS", subjectId: "m", gradingSlot: "period_1", status: "graded", score: 12, maxScoreSnapshot: 20 },
        { ...common, studentId: "e2", classId: "cS", subjectId: "m", gradingSlot: "period_1", status: "graded", score: 11, maxScoreSnapshot: 20 },
        { ...common, studentId: "e3", classId: "cP", subjectId: "m", gradingSlot: "period_1", status: "graded", score: 20, maxScoreSnapshot: 20 },
      ],
    });
    expect(result.classes).toEqual([{ classId: "cS", className: "5ème A", section: "Secondaire", students: 2, slots: [{ slot: "period_1", label: "1ère Période", evaluated: 2, average: 57.5 }] }]);
  });

  it("messagerie : le conseiller écrit à l'administration, à la direction et aux enseignants, jamais aux parents", () => {
    expect([...allowedRecipientRoles("pedagogical_advisor")].sort()).toEqual(["school_admin", "study_director", "teacher"]);
    expect(allowedRecipientRoles("parent").has("pedagogical_advisor")).toBe(false);
  });
});
