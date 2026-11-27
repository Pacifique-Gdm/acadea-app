import { describe, expect, it } from "vitest";
import { listAdvisorStudents } from "./advisors.js";
import { allowedRecipientRoles } from "./messageRecipients.js";
import { computeAdvisorResults, listOrientationNotes, normalizeNoteInput, saveOrientationNote, visibleNotes } from "./orientationAdvisor.js";

function fakeDb(initial: Record<string, Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(initial));
  let counter = 0;
  const docRef = (path: string) => ({
    id: path.split("/").pop()!, path,
    get: async () => ({ exists: store.has(path), id: path.split("/").pop()!, data: () => store.get(path) }),
    set: async (value: Record<string, unknown>) => { store.set(path, value); },
  });
  const query = (name: string, filters: Array<[string, unknown]> = []) => ({
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
    get: async () => ({ docs: [...store.entries()]
      .filter(([path]) => path.startsWith(`${name}/`) && path.split("/").length === 2)
      .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
      .map(([path, data]) => ({ id: path.split("/")[1], data: () => data })) }),
    doc: (id?: string) => docRef(`${name}/${id ?? `auto${++counter}`}`),
  });
  return {
    store, doc: docRef, collection: (name: string) => query(name),
    runTransaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      get: (ref: ReturnType<typeof docRef>) => ref.get(),
      set: (ref: ReturnType<typeof docRef>, value: Record<string, unknown>) => { store.set(ref.path, value); },
    }),
  };
}

const base = () => ({
  "schools/s1": { status: "active", schoolType: "Mixte" },
  "schoolYears/y1": { schoolId: "s1", status: "active" },
  "users/ori": { role: "orientation_advisor", schoolId: "s1", name: "Conseiller O", sectionIds: ["Secondaire"] },
  "users/ori2": { role: "orientation_advisor", schoolId: "s1", name: "Conseiller O2" },
  "users/ped": { role: "pedagogical_advisor", schoolId: "s1" },
  "users/dirS": { role: "study_director", schoolId: "s1", sectionIds: ["Secondaire"] },
  "users/dirP": { role: "study_director", schoolId: "s1", sectionIds: ["Primaire"] },
  "users/adm": { role: "school_admin", schoolId: "s1" },
  "users/tch": { role: "teacher", schoolId: "s1" },
  "users/par": { role: "parent", schoolId: "s1", parentId: "p1" },
  "students/e1": { schoolId: "s1", schoolYearId: "y1", fullName: "Mukendi Jean", className: "6ème", section: "Secondaire", balance: 20 },
  "students/e2": { schoolId: "s1", schoolYearId: "y1", fullName: "Petit Paul", className: "3ème Primaire", section: "Primaire" },
});
const caller = (uid: string, role: string) => ({ uid, role, schoolId: "s1" });
const body = { schoolId: "s1", schoolYearId: "y1" };
const note = { studentId: "e1", noteDate: "2026-11-20", kind: "interview", content: "Entretien : souhaite la filière scientifique." };

describe("Lot 11 — Conseiller d'orientation (serveur)", () => {
  it("élèves en lecture, sans argent, limités à ses sections", async () => {
    const db = fakeDb(base());
    const result = await listAdvisorStudents({ db, caller: caller("ori", "orientation_advisor"), body });
    expect(result.students.map((item: { name: string }) => item.name)).toEqual(["Mukendi Jean"]);
    expect(JSON.stringify(result)).not.toMatch(/balance/);
    const whole = await listAdvisorStudents({ db, caller: caller("ori2", "orientation_advisor"), body });
    expect(whole.students).toHaveLength(2);
  });

  it("notes : le conseiller crée et modifie SES notes, pour les élèves de ses sections", async () => {
    const db = fakeDb(base());
    const created = await saveOrientationNote({ db, caller: caller("ori", "orientation_advisor"), body: { ...body, note } });
    expect(created.note).toMatchObject({ studentName: "Mukendi Jean", className: "6ème", section: "Secondaire", authorId: "ori", kind: "interview" });
    const updated = await saveOrientationNote({ db, caller: caller("ori", "orientation_advisor"), body: { ...body, noteId: created.note.id, note: { ...note, content: "Corrigé" } } });
    expect(updated.note.content).toBe("Corrigé");
    await expect(saveOrientationNote({ db, caller: caller("ori2", "orientation_advisor"), body: { ...body, noteId: created.note.id, note } })).rejects.toMatchObject({ status: 403 });
    await expect(saveOrientationNote({ db, caller: caller("ori", "orientation_advisor"), body: { ...body, note: { ...note, studentId: "e2" } } })).rejects.toMatchObject({ status: 403 });
    for (const [uid, role] of [["ped", "pedagogical_advisor"], ["dirS", "study_director"], ["adm", "school_admin"], ["tch", "teacher"]]) {
      await expect(saveOrientationNote({ db, caller: caller(uid, role), body: { ...body, note } })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("notes confidentielles : lues par l'auteur, la direction des études de la section et l'administrateur ; JAMAIS par un enseignant ni un parent", async () => {
    const db = fakeDb(base());
    await saveOrientationNote({ db, caller: caller("ori", "orientation_advisor"), body: { ...body, note } });
    expect((await listOrientationNotes({ db, caller: caller("ori", "orientation_advisor"), body })).notes).toHaveLength(1);
    expect((await listOrientationNotes({ db, caller: caller("ori2", "orientation_advisor"), body })).notes).toHaveLength(0);
    expect((await listOrientationNotes({ db, caller: caller("dirS", "study_director"), body })).notes).toHaveLength(1);
    expect((await listOrientationNotes({ db, caller: caller("dirP", "study_director"), body })).notes).toHaveLength(0);
    expect((await listOrientationNotes({ db, caller: caller("adm", "school_admin"), body })).notes).toHaveLength(1);
    for (const [uid, role] of [["tch", "teacher"], ["par", "parent"], ["ped", "pedagogical_advisor"]]) {
      await expect(listOrientationNotes({ db, caller: caller(uid, role), body })).rejects.toMatchObject({ status: 403 });
    }
    expect(visibleNotes({ role: "teacher", uid: "tch", sections: [], notes: [{ authorId: "tch" }] })).toHaveLength(0);
  });

  it("notes : refus sur une année archivée et contenu contrôlé", async () => {
    const db = fakeDb({ ...base(), "schoolYears/y1": { schoolId: "s1", status: "archived" } });
    await expect(saveOrientationNote({ db, caller: caller("ori", "orientation_advisor"), body: { ...body, note } })).rejects.toMatchObject({ status: 409 });
    expect(() => normalizeNoteInput({ ...note, content: " " })).toThrow(/contenu/);
    expect(() => normalizeNoteInput({ ...note, noteDate: "hier" })).toThrow(/Date/);
    expect(normalizeNoteInput({ ...note, kind: "inconnu" }).kind).toBe("interview");
  });

  it("résultats : pourcentage et rang de la dernière période complète, sans aucun montant", () => {
    const common = { schoolId: "s1", schoolYearId: "y1" };
    const result = computeAdvisorResults({
      sections: [],
      students: [
        { id: "e1", ...common, fullName: "A", className: "6ème", classId: "c6", section: "Secondaire", status: "ACTIVE" },
        { id: "e2", ...common, fullName: "B", className: "6ème", classId: "c6", section: "Secondaire", status: "ACTIVE" },
      ],
      classes: [{ id: "c6", ...common, name: "6ème", section: "Secondaire" }],
      subjects: [{ id: "m", ...common, name: "Maths" }],
      assignments: [{ id: "a", ...common, classId: "c6", subjectId: "m", teacherId: "t", active: true }],
      configs: [],
      entries: [
        { ...common, studentId: "e1", classId: "c6", subjectId: "m", gradingSlot: "period_1", status: "graded", score: 15, maxScoreSnapshot: 20 },
        { ...common, studentId: "e2", classId: "c6", subjectId: "m", gradingSlot: "period_1", status: "graded", score: 10, maxScoreSnapshot: 20 },
      ],
    });
    expect(result.results).toEqual([
      expect.objectContaining({ studentId: "e1", percentage: 75, rank: 1, evaluated: 2, slotLabel: "1ère Période" }),
      expect.objectContaining({ studentId: "e2", percentage: 50, rank: 2, evaluated: 2 }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/amount|balance|payment/i);
  });

  it("résultats réservés au Conseiller d'orientation", async () => {
    const { loadAdvisorResults } = await import("./orientationAdvisor.js");
    const db = fakeDb(base());
    await expect(loadAdvisorResults({ db, caller: caller("ped", "pedagogical_advisor"), body })).rejects.toMatchObject({ status: 403 });
    await expect(loadAdvisorResults({ db, caller: caller("tch", "teacher"), body })).rejects.toMatchObject({ status: 403 });
    await expect(loadAdvisorResults({ db, caller: caller("ori", "orientation_advisor"), body })).resolves.toMatchObject({ sections: ["Secondaire"] });
  });
  it("messagerie : écrit à l'administration, à la direction et aux enseignants, jamais aux parents", () => {
    expect([...allowedRecipientRoles("orientation_advisor")].sort()).toEqual(["school_admin", "study_director", "teacher"]);
    expect(allowedRecipientRoles("parent").has("orientation_advisor")).toBe(false);
  });
});
