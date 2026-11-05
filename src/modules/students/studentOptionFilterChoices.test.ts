import { describe, expect, it } from "vitest";
import type { School, SchoolClassRecord, Student } from "../../types";
import { studentOptionFilterChoices } from "./studentOptionFilterChoices";

const school = { id: "school-a", schoolOptions: ["Sciences", "Littéraire", "Technique"] } as School;
const records = [
  { id: "base-1", schoolId: school.id, schoolYearId: "year", name: "1ère Humanité", active: true },
  { id: "base-2", schoolId: school.id, schoolYearId: "year", name: "2ème Humanité", active: true },
  { id: "base-1::sciences", parentClassId: "base-1", schoolId: school.id, schoolYearId: "year", name: "1ère Humanité Sciences", option: "Sciences", active: true },
  { id: "base-1::litteraire", parentClassId: "base-1", schoolId: school.id, schoolYearId: "year", name: "1ère Humanité Littéraire", option: "Littéraire", active: true },
  { id: "base-2::technique", parentClassId: "base-2", schoolId: school.id, schoolYearId: "year", name: "2ème Humanité Technique", option: "Technique", active: false },
  { id: "base-3", schoolId: school.id, schoolYearId: "year", name: "3ème Humanité", active: false },
  { id: "base-3::technique", parentClassId: "base-3", schoolId: school.id, schoolYearId: "year", name: "3ème Humanité Technique", option: "Technique", active: true },
  { id: "foreign::technique", schoolId: "school-b", schoolYearId: "year", name: "1ère Humanité Technique", option: "Technique", active: true },
] as SchoolClassRecord[];

function choices(className = "", section: "all" | "Primaire" | "Secondaire" = "all", students: Student[] = []) {
  return studentOptionFilterChoices({ school, schoolYearId: "year", records, students, className, section });
}

describe("dependent student option filters", () => {
  it("limits options to the selected class and excludes inactive or foreign records", () => {
    expect(choices()).toEqual(["Sciences", "Littéraire"]);
    expect(choices("1ère Humanité")).toEqual(["Sciences", "Littéraire"]);
    expect(choices("2ème Humanité")).toEqual([]);
    expect(choices("3ème Humanité")).toEqual([]);
  });

  it("does not show secondary options for classes and sections without options", () => {
    expect(choices("1ère Primaire")).toEqual([]);
    expect(choices("", "Primaire")).toEqual([]);
  });

  it("keeps configured historical options linked to enrolled students of the same year", () => {
    const student = { schoolId: school.id, schoolYearId: "year", className: "2ème Humanité", option: "Technique" } as Student;
    expect(choices("2ème Humanité", "Secondaire", [student])).toEqual(["Technique"]);
    expect(choices("1ère Humanité", "Secondaire", [student])).toEqual(["Sciences", "Littéraire"]);
    expect(choices("2ème Humanité", "Secondaire", [{ ...student, schoolId: "school-b" }])).toEqual([]);
  });
});
