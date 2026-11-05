import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DisciplineAttendanceDrawer } from "./DisciplineAttendanceDrawer";
import type { School, SchoolYear, SchoolClassRecord, Student } from "../../types";

describe("présences par classe opérationnelle", () => {
  it("sépare les subdivisions, conserve la classe vide et exclut l'autre établissement", () => {
    const base = { schoolId: "s", schoolYearId: "y", section: "Primaire" as const, active: true };
    const classRecords = [
      { ...base, id: "parent", name: "1ère Primaire" },
      { ...base, id: "a", name: "1ère Primaire", parentClassId: "parent", subClassLabel: "A" },
      { ...base, id: "b", name: "1ère Primaire", parentClassId: "parent", subClassLabel: "B" },
      { ...base, id: "empty", name: "2ème Primaire" },
      { ...base, id: "foreign", schoolId: "other", name: "Étranger" },
    ] as SchoolClassRecord[];
    const students: Student[] = ["a", "b"].map((id) => ({ ...base, id: `p-${id}`, nom: `Élève ${id}`, postnom:"Test", prenom:"", matricule:id, className: "1ère Primaire", classId:"parent", subClassId:id, status:"ACTIVE", sexe:"F",birthDate:"2016-01-01",address:"",phone:"" }));
    const html = renderToStaticMarkup(createElement(DisciplineAttendanceDrawer, {
      students, classRecords, attendance: [], allowedSections: ["Primaire"],
      school: { id:"s", name:"Test", schoolType:"Primaire uniquement" } as School,
      year: { id:"y", schoolId:"s", name:"Test" } as SchoolYear,
      onSaveManualAttendance: async () => ({created:0,existing:0,failed:0}),
    }));
    expect(html).toContain("1ère Primaire A"); expect(html).toContain("1ère Primaire B");
    expect(html).toContain("2ème Primaire"); expect(html).not.toContain("Étranger");
    expect((html.match(/<table/g) ?? []).length).toBe(3);
    expect((html.match(/Élève a/g) ?? []).length).toBe(1);
    expect((html.match(/Élève b/g) ?? []).length).toBe(1);
  });
});
