import { describe, expect, it } from "vitest";
import { canEnterRoute, getDefaultRoute, validateAdvisor } from "../../services/auth";
import type { AppUser } from "../../types";
import { ADVISOR_ROUTE, isAdvisorRole } from "../../utils/advisorRoles";
import { filterAdvisorStudents, type AdvisorOverview } from "./advisorService";
import { visitCourseChoices } from "./ClassVisitsContent";
import { pedagogicalAdvisorTabs } from "./advisorNavigation";

const advisor = { id: "u", role: "pedagogical_advisor", schoolId: "s1", status: "active", active: true } as AppUser;

describe("Lot 10 — Conseiller pédagogique (écran)", () => {
  it("rôle reconnu, route propre, aucun autre module", () => {
    expect(isAdvisorRole("pedagogical_advisor")).toBe(true);
    expect(isAdvisorRole("study_director")).toBe(false);
    expect(getDefaultRoute("pedagogical_advisor")).toBe(ADVISOR_ROUTE);
    expect(canEnterRoute(advisor, ADVISOR_ROUTE)).toBe(true);
    expect(canEnterRoute(advisor, "/studies")).toBe(false);
    expect(canEnterRoute(advisor, "/dashboard")).toBe(false);
    expect(canEnterRoute({ ...advisor, role: "teacher" }, ADVISOR_ROUTE)).toBe(false);
    expect(validateAdvisor({ ...advisor, status: "inactive" })).toBe(false);
  });

  it("5 onglets : Dashboard, Enseignants, Visites, Horaires, Menu", () => {
    expect(pedagogicalAdvisorTabs.map((tab) => tab.label)).toEqual(["Dashboard", "Enseignants", "Visites", "Horaires", "Menu"]);
  });

  it("recherche d'élève par nom, matricule ou classe", () => {
    const students = [
      { id: "1", name: "Mukendi Jean", matricule: "M1", className: "6ème", section: "Secondaire", gender: "", status: "ACTIVE" },
      { id: "2", name: "Kasa Paul", matricule: "K2", className: "3ème Primaire", section: "Primaire", gender: "", status: "ACTIVE" },
    ];
    expect(filterAdvisorStudents(students, "")).toHaveLength(2);
    expect(filterAdvisorStudents(students, "mukendi").map((item) => item.id)).toEqual(["1"]);
    expect(filterAdvisorStudents(students, "k2").map((item) => item.id)).toEqual(["2"]);
    expect(filterAdvisorStudents(students, "primaire").map((item) => item.id)).toEqual(["2"]);
  });

  it("formulaire de visite : enseignants et cours de la classe choisie", () => {
    const overview = {
      sections: [], classes: [], metrics: { teachers: 2, assignments: 2, subjects: 2, workload: 0, teachersWithoutAssignment: 0 },
      teachers: [
        { id: "t1", teacherName: "M. A", weeklyPeriods: 4, courses: [{ classId: "c1", subjectId: "m", subjectName: "Maths", className: "5ème", weeklyPeriods: 4 }] },
        { id: "t2", teacherName: "Mme B", weeklyPeriods: 3, courses: [{ classId: "c1", subjectId: "f", subjectName: "Français", className: "5ème", weeklyPeriods: 3 }, { classId: "c2", subjectId: "f", subjectName: "Français", className: "6ème", weeklyPeriods: 3 }] },
      ],
    } satisfies AdvisorOverview;
    expect(visitCourseChoices(overview, "c1", "")).toEqual({ teachers: [{ id: "t1", name: "M. A" }, { id: "t2", name: "Mme B" }], subjects: [{ id: "m", name: "Maths" }, { id: "f", name: "Français" }] });
    expect(visitCourseChoices(overview, "c1", "t2").subjects).toEqual([{ id: "f", name: "Français" }]);
    expect(visitCourseChoices(overview, "c3", "")).toEqual({ teachers: [], subjects: [] });
  });
});
