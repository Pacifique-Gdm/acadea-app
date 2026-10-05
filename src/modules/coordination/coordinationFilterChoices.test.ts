import { describe, expect, it } from "vitest";
import type { School, SchoolClassRecord, SchoolYear } from "../../types";
import { coordinationFilterChoices } from "./coordinationFilterChoices";
import { COORDINATION_ACTIVE_YEAR } from "../../services/coordinationStudentPagination";

const school = (id: string, year: string, options: string[]) => ({ id, name: id, status: "active", schoolType: "Secondaire", educationLevels: ["Secondaire"], schoolOptions: options, activeSchoolYearId: year }) as School;
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
    expect(all.classes.map((item) => item.value)).toContain("school-a::1ère Humanité");
    expect(all.classes.map((item) => item.value)).toContain("school-b::3ème Humanité");
    expect(all.classes).toHaveLength(8);
    expect(all.options).toEqual(["Littéraire", "Sciences"]);
    const a = coordinationFilterChoices(schools, years, records, "school-a", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "");
    expect(a.classes.map((item) => item.name)).toContain("1ère Humanité");
    expect(a.classes).toHaveLength(4);
    expect(a.options).toEqual(["Sciences"]);
    const b = coordinationFilterChoices(schools, years, records, "school-b", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "");
    expect(b.classes.map((item) => item.name)).toContain("3ème Humanité");
    expect(b.classes).toHaveLength(4);
    expect(b.options).toEqual(["Littéraire"]);
  });

  it("recalcule selon l'année et la classe sans importer une option d'une autre année", () => {
    const old = coordinationFilterChoices(schools, years, records, "school-a", "year-a1", ["Secondaire"], "school-a::2ème Humanité");
    expect(old.classes.map((item) => item.name)).toContain("2ème Humanité");
    expect(old.classes).toHaveLength(4);
    expect(old.options).toEqual(["Commerciale"]);
    const incompatible = coordinationFilterChoices(schools, years, records, "school-b", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "school-a::1ère Humanité");
    expect(incompatible.classes.some((item) => item.value === "school-a::1ère Humanité")).toBe(false);
    expect(incompatible.options).toEqual(["Littéraire"]);
  });

  it("conserve le référentiel scolaire uniquement pour une année legacy sans document de classe", () => {
    const choices = coordinationFilterChoices([schools[0]], [years[1]], [], "school-a", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "");
    expect(choices.classes.length).toBeGreaterThan(0);
    expect(choices.options).toEqual(["Commerciale", "Sciences"]);
    const parent = coordinationFilterChoices([schools[0]], [years[1]], [], "school-a", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "school-a::1ère Humanité");
    expect(parent.options).toEqual([]);
  });

  it("n'invente pas d'option dans une année opérationnelle qui n'en a aucune", () => {
    const primarySchool = { ...schools[1], educationLevels: ["Primaire"] } as School;
    const choices = coordinationFilterChoices([primarySchool], [years[2]], [parent("b-only", "school-b", "year-b1", "1ère Primaire")], "school-b", COORDINATION_ACTIVE_YEAR, [], "school-b::1ère Primaire");
    expect(choices.options).toEqual([]);
  });

  it("ne présente pas une option legacy sans parentClassId comme classe parent", () => {
    const legacy = [parent("humanity", "school-a", "year-a2", "1ère Humanité"),
      { id: "humanity::scientifique", schoolId: "school-a", schoolYearId: "year-a2", name: "1ère Scientifique", active: true } as SchoolClassRecord];
    const choices = coordinationFilterChoices([schools[0]], [years[1]], legacy, "school-a", COORDINATION_ACTIVE_YEAR, ["Secondaire"], "school-a::1ère Humanité");
    expect(choices.classes.map((item) => item.name)).toContain("1ère Humanité");
    expect(choices.classes).toHaveLength(4);
    expect(choices.options).toEqual(["Sciences"]);
    expect(choices.classes[0].branchesBySource["school-a::year-a2"]).toEqual([
      { name: "1ère Humanité", operational: false },
      { name: "1ère Scientifique", option: "Sciences", operational: true },
    ]);
  });

  it("distingue quatre écoles, leurs parents, leurs options et leurs années", () => {
    const scopedSchools = ["a", "b", "c", "d"].map((id) => ({ ...school(`school-${id}`, `year-${id}`, ["Sciences", "Littéraire", "Commerciale"]), educationLevels: [id === "a" ? "Primaire" : id === "b" ? "CTEB" : "Secondaire"] }) as School);
    const scopedYears = scopedSchools.map((item) => year(item.activeSchoolYearId!, item.id));
    const scopedRecords = [
      parent("primary", "school-a", "year-a", "1ère Primaire"),
      parent("cteb", "school-b", "year-b", "7ème CTEB"),
      parent("c-humanity", "school-c", "year-c", "2ème Humanité"),
      option("c-sciences", "school-c", "year-c", "c-humanity", "Sciences"),
      option("c-literary", "school-c", "year-c", "c-humanity", "Littéraire"),
      option("c-commerce", "school-c", "year-c", "c-humanity", "Commerciale"),
      parent("d-humanity", "school-d", "year-d", "1ère Humanité"),
      option("d-sciences", "school-d", "year-d", "d-humanity", "Sciences"),
      option("d-literary", "school-d", "year-d", "d-humanity", "Littéraire"),
      parent("d-old", "school-d", "year-old", "3ème Humanité"),
    ];
    const all = coordinationFilterChoices(scopedSchools, scopedYears, scopedRecords, "", COORDINATION_ACTIVE_YEAR, [], "");
    for (const label of ["1ère Humanité — school-d", "1ère Primaire — school-a", "2ème Humanité — school-c", "7ème CTEB — school-b"]) {
      expect(all.classes.map((item) => item.label)).toContain(label);
    }
    expect(all.classes.filter((item) => item.schoolId === "school-a")).toHaveLength(6);
    expect(all.classes.filter((item) => item.schoolId === "school-b")).toHaveLength(2);
    expect(all.classes.some((item) => /Sciences|Littéraire|Commerciale/.test(item.name))).toBe(false);
    const selected = coordinationFilterChoices(scopedSchools, scopedYears, scopedRecords, "", COORDINATION_ACTIVE_YEAR, [], "school-d::1ère Humanité");
    expect(selected.options).toEqual(["Littéraire", "Sciences"]);
    expect(selected.classes.find((item) => item.schoolId === "school-d")?.branchesBySource["school-d::year-d"].map((item) => item.name))
      .toEqual(["1ère Humanité", "Sciences A", "Littéraire A"]);
  });

  it("garde tous les parents autorisés par les sections même si les documents de l'année sont partiels", () => {
    const configured = { ...school("configured", "active-year", ["Sciences", "Littéraire"]), schoolType: "Mixte", educationLevels: ["Primaire", "CTEB", "Secondaire"] } as School;
    const sparse = [
      parent("configured__active-year__7eme-cteb", configured.id, "active-year", "7ème CTEB"),
      parent("configured__active-year__1ere-humanite", configured.id, "active-year", "1ère"),
      { id: "configured__active-year__1ere-humanite::sciences", schoolId: configured.id, schoolYearId: "active-year", name: "1ère Sciences", parentClassId: "configured__active-year__1ere-humanite", option: "Sciences", active: true } as SchoolClassRecord,
    ];
    const all = coordinationFilterChoices([configured], [year("active-year", configured.id)], sparse, configured.id, COORDINATION_ACTIVE_YEAR, [], "");
    expect(all.classes.map((item) => item.name)).toContain("3ème Primaire");
    expect(all.classes.map((item) => item.name)).toContain("8ème CTEB");
    expect(all.classes.map((item) => item.name)).toContain("1ère Humanité");
    expect(all.classes.map((item) => item.name)).toContain("3ème Humanité");
    expect(all.classes.map((item) => item.name)).not.toContain("1ère");
    expect(all.classes.map((item) => item.name)).not.toContain("1ère Sciences");
    const humanity = coordinationFilterChoices([configured], [year("active-year", configured.id)], sparse, configured.id, COORDINATION_ACTIVE_YEAR, [], "configured::1ère Humanité");
    expect(humanity.options).toEqual(["Sciences"]);
    expect(humanity.classes.find((item) => item.name === "1ère Humanité")?.branchesBySource["configured::active-year"]).toEqual([
      { name: "1ère Humanité", operational: false },
      { name: "1ère Sciences", option: "Sciences", operational: true },
    ]);
    const unmaterialized = coordinationFilterChoices([configured], [year("active-year", configured.id)], sparse, configured.id, COORDINATION_ACTIVE_YEAR, [], "configured::3ème Humanité");
    expect(unmaterialized.options).toEqual([]);
  });

  it("reflète immédiatement une modification des sections de l'école sans liste de classes parallèle", () => {
    const configured = school("dynamic", "dynamic-year", ["Sciences"]);
    const currentYear = year("dynamic-year", configured.id);
    const before = coordinationFilterChoices([configured], [currentYear], [], configured.id, COORDINATION_ACTIVE_YEAR, [], "");
    expect(before.classes.some((item) => item.name === "3ème Primaire")).toBe(false);
    const updated = { ...configured, educationLevels: ["Primaire", "Secondaire"] } as School;
    const after = coordinationFilterChoices([updated], [currentYear], [], updated.id, COORDINATION_ACTIVE_YEAR, [], "");
    expect(after.classes.some((item) => item.name === "3ème Primaire")).toBe(true);
    expect(after.classes.some((item) => item.name === "3ème Humanité")).toBe(true);
    const restricted = coordinationFilterChoices([updated], [currentYear], [], updated.id, COORDINATION_ACTIVE_YEAR, ["Primaire"], "");
    expect(restricted.classes.every((item) => /Primaire/.test(item.name))).toBe(true);
  });
});
