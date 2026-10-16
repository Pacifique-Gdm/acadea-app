import { describe, expect, it } from "vitest";
import { readPublishedTimetable } from "./publishedTimetableRead.js";

function fixture() {
  const data = new Map<string, Record<string, unknown>>([
    ["users/admin-a", { role: "school_admin", schoolId: "school-a", status: "active" }],
    ["users/director-a", { role: "study_director", schoolId: "school-a", status: "active" }],
    ["users/discipline-a", { role: "discipline_director", schoolId: "school-a", status: "active" }],
    ["users/teacher-user-a", { role: "teacher", schoolId: "school-a", status: "active" }],
    ["users/secretary-a", { role: "secretary", schoolId: "school-a", status: "active" }],
    ["users/cashier-a", { role: "cashier", schoolId: "school-a", status: "active" }],
    ["schoolYears/year-a", { schoolId: "school-a", status: "archived" }],
    ["schoolYears/year-b", { schoolId: "school-b", status: "active" }],
    ["timetables/published-a", { schoolId: "school-a", schoolYearId: "year-a", status: "PUBLISHED", activePublished: true, version: 3 }],
    ["timetables/draft-a", { schoolId: "school-a", schoolYearId: "year-a", status: "DRAFT", activePublished: false, version: 4 }],
    ["timetableEntries/tuesday", { schoolId: "school-a", schoolYearId: "year-a", scheduleId: "published-a", dayOfWeek: "tuesday", periodId: "p1", classId: "class-a", subjectId: "math", teacherId: "teacher-a" }],
    ["timetableEntries/monday-late", { schoolId: "school-a", schoolYearId: "year-a", scheduleId: "published-a", dayOfWeek: "monday", periodId: "p2", classId: "class-a", subjectId: "math", teacherId: "teacher-a" }],
    ["timetableEntries/monday-early", { schoolId: "school-a", schoolYearId: "year-a", scheduleId: "published-a", dayOfWeek: "monday", periodId: "p1", classId: "class-a", subjectId: "math", teacherId: "teacher-a" }],
    ["timetableEntries/other-teacher", { schoolId: "school-a", schoolYearId: "year-a", scheduleId: "published-a", dayOfWeek: "wednesday", periodId: "p1", classId: "class-a", subjectId: "math", teacherId: "teacher-b" }],
    ["timetableEntries/draft-entry", { schoolId: "school-a", schoolYearId: "year-a", scheduleId: "draft-a", dayOfWeek: "thursday", periodId: "p1", classId: "class-a", subjectId: "math", teacherId: "teacher-a" }],
    ["schedulePeriods/p1", { schoolId: "school-a", schoolYearId: "year-a", label: "Première période", startTime: "08:00", endTime: "09:00" }],
    ["schedulePeriods/p2", { schoolId: "school-a", schoolYearId: "year-a", label: "Deuxième période", startTime: "09:00", endTime: "10:00" }],
    ["classes/class-a", { schoolId: "school-a", schoolYearId: "year-a", name: "4e Humanité" }],
    ["subjects/math", { schoolId: "school-a", schoolYearId: "year-a", name: "Mathématiques" }],
    ["teachers/teacher-a", { schoolId: "school-a", schoolYearId: "year-a", userId: "teacher-user-a", firstName: "Ada", lastName: "Lovelace", status: "active" }],
    ["teachers/teacher-b", { schoolId: "school-a", schoolYearId: "year-a", userId: "other-user", firstName: "Grace", lastName: "Hopper", status: "active" }],
  ]);
  const db = {
    collection(name: string) {
      const filters: Array<[string, unknown]> = [];
      let count = Infinity;
      const query = {
        where(field: string, _operator: string, value: unknown) { filters.push([field, value]); return query; },
        limit(value: number) { count = value; return query; },
        async get() {
          const docs = [...data.entries()].filter(([path, value]) => path.startsWith(`${name}/`) && filters.every(([field, expected]) => value[field] === expected)).slice(0, count).map(([path, value]) => ({ id: path.slice(name.length + 1), data: () => value }));
          return { docs };
        },
        doc(id: string) { return { async get() { const value = data.get(`${name}/${id}`); return { exists: Boolean(value), data: () => value }; } }; },
      };
      return query;
    },
  };
  const caller = (role: string, uid: string) => ({ role, uid, schoolId: "school-a" });
  return { db, data, caller };
}

describe("projection serveur de l'horaire publié", () => {
  it("résout l'ancien horaire publié depuis les références officielles et trie par jour puis heure", async () => {
    const { db, caller } = fixture();
    for (const role of [caller("school_admin", "admin-a"), caller("study_director", "director-a"), caller("secretary", "secretary-a"), caller("discipline_director", "discipline-a")]) {
      const result = await readPublishedTimetable({ db, caller: role, schoolYearId: "year-a" });
      expect(result.version).toBe(3);
      expect(result.rows.map((row: { dayOfWeek: string; startTime: string }) => `${row.dayOfWeek}:${row.startTime}`)).toEqual(["monday:08:00", "monday:09:00", "tuesday:08:00", "wednesday:08:00"]);
      expect(result.rows[0]).toMatchObject({ periodLabel: "Première période · 08:00–09:00", classLabel: "4e Humanité", subjectLabel: "Mathématiques", teacherDisplayName: "Ada Lovelace" });
      expect(JSON.stringify(result)).not.toContain("teacher-a");
      expect(JSON.stringify(result)).not.toContain("class-a");
      expect(JSON.stringify(result)).not.toContain("draft-a");
    }
  });

  it("limite l'Enseignant à son propre profil et à ses cours publiés", async () => {
    const { db, caller } = fixture();
    const result = await readPublishedTimetable({ db, caller: caller("teacher", "teacher-user-a"), schoolYearId: "year-a" });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((row: { teacherDisplayName: string }) => row.teacherDisplayName === "Ada Lovelace")).toBe(true);
  });

  it("compose le libellé officiel d'une sous-classe sans répéter option ou suffixe", async () => {
    const { db, data, caller } = fixture();
    data.set("classes/class-a", { schoolId: "school-a", schoolYearId: "year-a", name: "4e Humanité", option: "Littéraire", subClassLabel: "A" });
    const result = await readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-a" });
    expect(result.rows[0].classLabel).toBe("4e Littéraire A");
    data.set("classes/class-a", { ...data.get("classes/class-a"), active: false });
    const inactive = await readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-a" });
    expect(inactive.rows[0].classLabel).toBe("Classe opérationnelle indisponible");
  });

  it("résout le nom du compte Enseignant lié lorsque le profil métier ne porte pas de nom", async () => {
    const { db, data, caller } = fixture();
    data.set("teachers/teacher-a", { schoolId: "school-a", schoolYearId: "year-a", userId: "teacher-user-a", status: "active" });
    data.set("users/teacher-user-a", { role: "teacher", schoolId: "school-a", status: "active", name: "Ada Lovelace" });
    const result = await readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-a" });
    expect(result.rows[0].teacherDisplayName).toBe("Ada Lovelace");
  });

  it("affiche les seules classes d'option opérationnelles de l'affectation publiée", async () => {
    const { db, data, caller } = fixture();
    data.set("timetableEntries/monday-early", { ...data.get("timetableEntries/monday-early"), targetOptionIds: ["option-literary", "option-science"] });
    data.set("classes/option-literary", { schoolId: "school-a", schoolYearId: "year-a", name: "4e Humanité", option: "Littéraire", classOptionKey: "option-literary", active: true });
    data.set("classes/option-science", { schoolId: "school-a", schoolYearId: "year-a", name: "4e Humanité", option: "Scientifique", classOptionKey: "option-science", active: true });
    const result = await readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-a" });
    expect(result.rows[0].classLabel).toBe("4e Littéraire + 4e Scientifique");
    data.set("classes/option-science", { schoolId: "school-b", schoolYearId: "year-b", name: "Classe étrangère", classOptionKey: "option-science" });
    const after = await readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-a" });
    expect(after.rows[0].classLabel).toBe("Classe opérationnelle indisponible");
  });

  it("refuse un rôle, une école, une année et un profil falsifiés", async () => {
    const { db, data, caller } = fixture();
    await expect(readPublishedTimetable({ db, caller: caller("cashier", "cashier-a"), schoolYearId: "year-a" })).rejects.toMatchObject({ status: 403 });
    await expect(readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-b" })).rejects.toMatchObject({ status: 403 });
    await expect(readPublishedTimetable({ db, caller: { ...caller("school_admin", "admin-a"), schoolId: "school-b" }, schoolYearId: "year-a" })).rejects.toMatchObject({ status: 403 });
    await expect(readPublishedTimetable({ db, caller: caller("teacher", "admin-a"), schoolYearId: "year-a" })).rejects.toMatchObject({ status: 403 });
    data.set("users/admin-a", { role: "school_admin", schoolId: "school-a", status: "inactive" });
    await expect(readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-a" })).rejects.toMatchObject({ status: 403 });
  });

  it("ne montre pas de brouillon et fournit des libellés contrôlés pour références absentes ou étrangères", async () => {
    const { db, data, caller } = fixture();
    data.set("classes/class-a", { schoolId: "school-b", schoolYearId: "year-b", name: "Classe étrangère" });
    data.delete("subjects/math");
    data.set("teachers/teacher-a", { schoolId: "school-a", schoolYearId: "year-b", firstName: "Nom", lastName: "Autre année" });
    data.delete("schedulePeriods/p1");
    const result = await readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-a" });
    expect(result.rows.find((row: { periodLabel: string }) => row.periodLabel === "Période indisponible")).toMatchObject({ classLabel: "Classe opérationnelle indisponible", subjectLabel: "Matière indisponible", teacherDisplayName: "Enseignant indisponible" });
    expect(JSON.stringify(result)).not.toContain("Classe étrangère");
    expect(JSON.stringify(result)).not.toContain("Nom Autre année");
    data.delete("timetables/published-a");
    expect(await readPublishedTimetable({ db, caller: caller("school_admin", "admin-a"), schoolYearId: "year-a" })).toBeNull();
  });
});
