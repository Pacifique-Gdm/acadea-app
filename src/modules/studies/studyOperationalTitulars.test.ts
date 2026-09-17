import { describe, expect, it } from "vitest";
import type { StudyClass } from "./studyTypes";
import { operationalTitularClasses } from "./studyCourseScope";

const base = (id: string, name: string): StudyClass => ({ id, name, schoolId: "school", schoolYearId: "year", active: true });
const option = (parent: StudyClass, key: string, name: string): StudyClass => ({
  ...base(`${parent.id}::${key}`, name),
  parentClassId: parent.id,
  classOptionKey: `${parent.id}::${key}`,
  option: key,
});

describe("classes opérationnelles de titularité", () => {
  const primary = base("p3", "3ème Primaire");
  const humanity = base("h3", "3ème Humanité");
  const science = option(humanity, "sciences", "3ème Sciences");
  const literary = option(humanity, "litteraire", "3ème Littéraire");
  const pedagogy = option(humanity, "pedagogie", "3ème Pédagogie générale");

  it("conserve une classe simple sans enfant opérationnel", () => {
    expect(operationalTitularClasses([{ classId: primary.id }], [primary])).toEqual([primary]);
  });

  it("remplace le parent Humanité par ses classes opérationnelles réelles", () => {
    expect(operationalTitularClasses([{ classId: humanity.id }], [humanity, science, literary, pedagogy]).map((item) => item.id))
      .toEqual([literary.id, pedagogy.id, science.id]);
  });

  it("respecte les options du cours et plusieurs classes sélectionnées", () => {
    expect(operationalTitularClasses([
      { classId: humanity.id, courseScope: "option", targetOptionIds: [literary.id] },
      { classId: primary.id },
    ], [humanity, science, literary, pedagogy, primary]).map((item) => item.id)).toEqual([literary.id, primary.id]);
  });

  it("n'invente aucune option et ignore les classes inactives", () => {
    expect(operationalTitularClasses([
      { classId: humanity.id, courseScope: "option", targetOptionIds: [`${humanity.id}::inconnue`] },
    ], [humanity, science, { ...literary, active: false }])).toEqual([]);
  });
});
