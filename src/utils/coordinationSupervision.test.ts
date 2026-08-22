import { describe, expect, it } from "vitest";
import type { School, Student } from "../types";
import { buildCoordinationClassChoices, buildCoordinationOptionChoices, filterCoordinationStudents } from "./coordinationSupervision";

const schools = [{ id: "a", name: "École A" }, { id: "b", name: "École B" }] as School[];
const student = (id: string, schoolId: string, option: string): Student => ({ id, schoolId, schoolYearId: `year-${schoolId}`, matricule: id, nom: "K", postnom: "", prenom: id, sexe: "M", birthDate: "2012-01-01", address: "", phone: "", className: "2ème Humanité", classId: `class-${schoolId}`, classOptionKey: `class-${schoolId}::${option}`, option });

describe("filtres de supervision Coordination", () => {
  it("ne fusionne pas les classes ni options homonymes de deux écoles", () => {
    const students = [student("a-1", "a", "Littéraire"), student("b-1", "b", "Littéraire")];
    expect(buildCoordinationClassChoices(students, schools, "")).toHaveLength(2);
    expect(buildCoordinationOptionChoices(students, schools, "")).toHaveLength(2);
  });

  it("compose école, recherche, statut, classe et option", () => {
    const first = student("a-1", "a", "Littéraire");
    const second = { ...student("a-2", "a", "Sciences"), status: "DROPPED" as const };
    const classKey = buildCoordinationClassChoices([first, second], schools, "a")[0].value;
    const optionKey = buildCoordinationOptionChoices([first, second], schools, "a", classKey)[0].value;
    expect(filterCoordinationStudents({ students: [first, second], selectedSchoolId: "a", search: "a-1", status: "active", classKey, optionKey })).toEqual([first]);
  });
});
