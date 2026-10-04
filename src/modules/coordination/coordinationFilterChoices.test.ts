import { describe, expect, it } from "vitest";
import type { School, SchoolClassRecord, SchoolYear } from "../../types";
import { coordinationFilterChoices } from "./coordinationFilterChoices";
import { COORDINATION_ACTIVE_YEAR } from "../../services/coordinationStudentPagination";

const school = (id: string, year: string, options: string[]) => ({ id, name: id, status: "active", schoolType: "Secondaire", schoolOptions: options, activeSchoolYearId: year }) as School;
const year = (id: string, schoolId: string) => ({ id, schoolId, name: id, status: "active" }) as SchoolYear;
const parent = (id: string, schoolId: string, schoolYearId: string, name: string) => ({ id, schoolId, schoolYearId, name, active: true }) as SchoolClassRecord;
const option = (id: string, schoolId: string, schoolYearId: string, parentClassId: string, name: string) => ({ id, schoolId, schoolYearId, parentClassId, name: `${name} A`, option: name, active: true }) as SchoolClassRecord;

const schools = [school("school-a", "year-a2", ["Sciences", "Commerciale"]), school("school-b", "year-b1", ["Littéraire"])];
const years = [year("year-a1", "school-a"), year("year-a2", "school-a"), year("year-b1", "school-b")];
const records = [
  parent("a-old", "school-a", "year-a1", "2ème Humanité"), option("a-old-option", "school-a", "year-a1", "a-old", "Commerciale"),
  parent("a-new", "school-a", "year-a2", "1ère Humanité"), option("a-new-option", "school-a", "year-a2", "a-new", "Sciences"),
  parent("b-new", "school-b", "year-b1", "3ème Humanité"), option("b-new-option", "school-b", "year-b1", "b-new", "Littéraire"),
];

describe("filtres Coordination en cascade", () => {
  it("borne classes et options à chaque école et à son année active propre", () => {
    const all = coordinationFilterChoices(schools, years, records, "", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "");
    expect(all.classes.map((item) => item.value)).toEqual(["school-a::1ère Humanité", "school-b::3ème Humanité"]);
    expect(all.options).toEqual(["Littéraire", "Sciences"]);
    const a = coordinationFilterChoices(schools, years, records, "school-a", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "");
    expect(a.classes.map((item) => item.name)).toEqual(["1ère Humanité"]);
    expect(a.options).toEqual(["Sciences"]);
    const b = coordinationFilterChoices(schools, years, records, "school-b", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "");
    expect(b.classes.map((item) => item.name)).toEqual(["3ème Humanité"]);
    expect(b.options).toEqual(["Littéraire"]);
  });

  it("recalcule selon l'année et la classe sans importer une option d'une autre année", () => {
    const old = coordinationFilterChoices(schools, years, records, "school-a", "year-a1", ["Secondaire"], "school-a::2ème Humanité");
    expect(old.classes.map((item) => item.name)).toEqual(["2ème Humanité"]);
    expect(old.options).toEqual(["Commerciale"]);
    const incompatible = coordinationFilterChoices(schools, years, records, "school-b", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "school-a::1ère Humanité");
    expect(incompatible.classes.some((item) => item.value === "school-a::1ère Humanité")).toBe(false);
    expect(incompatible.options).toEqual(["Littéraire"]);
  });

  it("conserve le référentiel scolaire uniquement pour une année legacy sans document de classe", () => {
    const choices = coordinationFilterChoices([schools[0]], [years[1]], [], "school-a", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "");
    expect(choices.classes.length).toBeGreaterThan(0);
    expect(choices.options).toEqual(["Commerciale", "Sciences"]);
  });

  it("n'invente pas d'option dans une année opérationnelle qui n'en a aucune", () => {
    const choices = coordinationFilterChoices([schools[1]], [years[2]], [parent("b-only", "school-b", "year-b1", "1ère Primaire")], "school-b", COORDINATION_ACTIVE_YEAR, [], "");
    expect(choices.options).toEqual([]);
  });
});
