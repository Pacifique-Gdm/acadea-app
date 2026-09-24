import { describe, expect, it } from "vitest";
import { activeSubclasses, canonicalOperationalClasses, classesWithEnrolledStudents, formatOperationalStudentClassName, operationalClasses, operationalSchoolClasses, resolveStudentParentClass, schoolClassOptionKey, schoolClassRecordId, secondarySubclassesForOption, studentBelongsToOperationalClass, studentSchoolClassOptionKey, subclassCreationScopeIsValid, validateSubclassLabels, validateSubclassCreation, validateStudentAcademicSelection } from "./schoolSubclasses";
import fs from "node:fs";
import type { SchoolClassRecord } from "../types";
const base = (id: string, extra: Partial<SchoolClassRecord> = {}): SchoolClassRecord => ({ id, schoolId: "school-a", schoolYearId: "year-a", name: id, active: true, ...extra });
it("filtre les classes opérationnelles par école, année et sections", () => { const items = [base("parent", { name: "1ère Humanité" }), base("commerciale", { name: "1ère Humanité Commerciale", parentClassId: "parent" }), base("Primaire", { name: "1ère Primaire" }), { ...base("foreign", { name: "2ème Humanité" }), schoolId: "school-b" }]; expect(operationalSchoolClasses(items, "school-a", "year-a", ["Secondaire"]).map((item) => item.id)).toEqual(["commerciale"]); });
describe("sous-classes structurées", () => {
  it("reproduit l'ajout incrémental et borne les vrais doublons au parent, à l'école, à l'année et à l'option", () => {
    const parent = base("parent", { name: "7ème CTEB" });
    const a = base("a", { parentClassId: parent.id, subClassLabel: "A" });
    expect(validateSubclassCreation(["B"], [parent, a], parent)).toBe("");
    expect(validateSubclassCreation(["A"], [parent, a], parent)).toContain("existe déjà");
    expect(validateSubclassCreation([" a "], [parent, a], parent)).toContain("existe déjà");
    expect(validateSubclassCreation(["A"], [parent, { ...a, parentClassId: "other" }], parent)).toBe("");
    expect(validateSubclassCreation(["A"], [parent, { ...a, schoolId: "school-b" }], parent)).toBe("");
    expect(validateSubclassCreation(["A"], [parent, { ...a, schoolYearId: "year-b" }], parent)).toBe("");
  });
  it("refuse l'option ou la sous-classe manquante et les références hors périmètre", () => {
    const humanites = base("humanites", { name: "1ère Humanité" });
    const literary = schoolClassOptionKey(humanites.id, "Littéraire");
    const a = base("lit-a", { parentClassId: humanites.id, classOptionKey: literary, subClassLabel: "A" });
    const cteb = base("cteb", { name: "7ème CTEB" });
    const ctebA = base("cteb-a", { parentClassId: cteb.id, subClassLabel: "A" });
    const rows = [humanites, a, cteb, ctebA];
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: humanites.id, className: humanites.name };
    expect(validateStudentAcademicSelection(rows, student, ["Littéraire", "Sciences"])).toContain("option");
    expect(validateStudentAcademicSelection(rows, { ...student, option: "Littéraire" }, ["Littéraire", "Sciences"])).toContain("sous-classe");
    expect(validateStudentAcademicSelection(rows, { ...student, option: "Littéraire", subClassId: a.id }, ["Littéraire", "Sciences"])).toBe("");
    expect(validateStudentAcademicSelection(rows, { ...student, option: "Sciences", subClassId: a.id }, ["Littéraire", "Sciences"])).toContain("sous-classe");
    expect(validateStudentAcademicSelection(rows, { ...student, option: "Inconnue" }, ["Littéraire", "Sciences"])).toContain("option");
    expect(validateStudentAcademicSelection(rows, { ...student, option: "Littéraire", subClassId: "foreign" }, ["Littéraire", "Sciences"])).toContain("sous-classe");
    expect(validateStudentAcademicSelection([humanites, { ...a, schoolId: "school-b" }], { ...student, option: "Littéraire", subClassId: a.id }, ["Littéraire", "Sciences"])).toContain("sous-classe");
    expect(validateStudentAcademicSelection([humanites, { ...a, schoolYearId: "year-b" }], { ...student, option: "Littéraire", subClassId: a.id }, ["Littéraire", "Sciences"])).toContain("sous-classe");
    expect(validateStudentAcademicSelection(rows, { schoolId: "school-a", schoolYearId: "year-a", classId: cteb.id, className: cteb.name }, [])).toContain("sous-classe");
    expect(validateStudentAcademicSelection(rows, { schoolId: "school-a", schoolYearId: "year-a", classId: cteb.id, className: cteb.name, subClassId: ctebA.id }, [])).toBe("");
  });
  it("autorise l'ajout d'une seule sous-classe, mais refuse un libellé vide", () => { expect(activeSubclasses([base("parent")], "parent")).toEqual([]); expect(validateSubclassLabels(["A"])).toBe(""); expect(validateSubclassLabels([""])).toContain("au moins une"); expect(validateSubclassLabels(["A", "B"])).toBe(""); });
  it("refuse les doublons normalisés", () => expect(validateSubclassLabels([" A ", "a"])).toContain("uniques"));
  it("expose les sous-classes comme unités opérationnelles", () => { const rows = [base("parent"), base("a", { parentClassId: "parent" }), base("b", { parentClassId: "parent" }), base("normal")]; expect(operationalClasses(rows).map((item) => item.id)).toEqual(["a", "b", "normal"]); });
  it("ne mélange pas deux classes principales", () => { const rows = [base("a", { parentClassId: "x" }), base("b", { parentClassId: "y" })]; expect(activeSubclasses(rows, "x").map((item) => item.id)).toEqual(["a"]); });
  it("isole deux options de la même classe et autorise le même libellé dans chacune", () => {
    const scientific = schoolClassOptionKey("secondary-1", "Scientifique");
    const literary = schoolClassOptionKey("secondary-1", "Littéraire");
    const rows = [
      base("scientific-a", { parentClassId: "secondary-1", classOptionKey: scientific, subClassLabel: "A" }),
      base("literary-a", { parentClassId: "secondary-1", classOptionKey: literary, subClassLabel: "A" }),
    ];
    expect(secondarySubclassesForOption(rows, "secondary-1", scientific).map((item) => item.id)).toEqual(["scientific-a"]);
    expect(secondarySubclassesForOption(rows, "secondary-1", literary).map((item) => item.id)).toEqual(["literary-a"]);
  });
  it("conserve uniquement la sous-classe legacy déjà sélectionnée pendant une modification", () => {
    const rows = [base("legacy-a", { parentClassId: "secondary-1", subClassLabel: "A" }), base("legacy-b", { parentClassId: "secondary-1", subClassLabel: "B" })];
    expect(secondarySubclassesForOption(rows, "secondary-1", schoolClassOptionKey("secondary-1", "Scientifique"), "legacy-a").map((item) => item.id)).toEqual(["legacy-a"]);
  });
  it("génère un identifiant stable pour une classe legacy", () => expect(schoolClassRecordId("school-a", "year-a", "7ème CTEB")).toBe("school-a__year-a__7eme-cteb"));
  it("valide l’année ouverte du module sans dépendre de l’année historique du profil", () => {
    expect(subclassCreationScopeIsValid(base("parent"), "school-a", "year-a")).toBe(true);
    expect(subclassCreationScopeIsValid(base("parent"), "school-a", "year-b")).toBe(false);
    expect(subclassCreationScopeIsValid(base("parent"), "school-b", "year-a")).toBe(false);
  });
  it("branche le bouton partagé dans l'ordre classe puis option puis sous-classe", () => { const form = fs.readFileSync("src/components/students/StudentForm.tsx", "utf8"); const module = fs.readFileSync("src/modules/students/StudentsModule.tsx", "utf8"); expect(form).toContain("resolveStudentParentClass(structuredClasses, form)"); expect(form).toContain("schoolClassRecordId("); expect(form.indexOf("Option")).toBeLessThan(form.indexOf("Ajouter sous-classe")); expect(form).toContain("Sélectionnez d’abord une option."); expect(form).toContain("subClassId: undefined"); expect(form).toContain("nextSubclassLetters(existingSubclassLabels"); expect(form).toContain("Sous-classe ${index + 1}"); expect(module).toContain("subscribeToSchoolClasses"); expect(module).toContain("createSchoolSubclasses"); });

  it("résout le parent tenanté d'un formulaire legacy sans classId", () => {
    const parent = base("cteb-7", { name: "7ème CTEB" });
    expect(resolveStudentParentClass([parent], {
      schoolId: "school-a",
      schoolYearId: "year-a",
      className: "7ème CTEB",
    })?.id).toBe(parent.id);
  });

  it("refuse de résoudre un parent homonyme d'une autre école ou année", () => {
    const foreignSchool = { ...base("foreign-school", { name: "7ème CTEB" }), schoolId: "school-b" };
    const foreignYear = { ...base("foreign-year", { name: "7ème CTEB" }), schoolYearId: "year-b" };
    expect(resolveStudentParentClass([foreignSchool, foreignYear], {
      schoolId: "school-a",
      schoolYearId: "year-a",
      className: "7ème CTEB",
    })).toBeUndefined();
  });

  it("préserve l'appartenance école, année, classe et option de la sous-classe", () => {
    const parent = base("humanity-1", { name: "1ère Humanité", section: "Secondaire" });
    const literaryKey = schoolClassOptionKey(parent.id, "Littéraire");
    const literaryA = base("literary-a", { parentClassId: parent.id, classOptionKey: literaryKey, subClassLabel: "A" });
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: parent.id, subClassId: literaryA.id, classOptionKey: literaryKey, className: "1ère Humanité" };
    expect(resolveStudentParentClass([parent, literaryA], student)?.id).toBe(parent.id);
    expect(formatOperationalStudentClassName({ ...student, option: "Littéraire" }, [parent, literaryA])).toBe("1ère Littéraire A");
    expect(formatOperationalStudentClassName({ ...student, schoolId: "school-b", option: "Littéraire" }, [parent, literaryA])).toBe("1ère Littéraire");
    expect(formatOperationalStudentClassName({ ...student, schoolYearId: "year-b", option: "Littéraire" }, [parent, literaryA])).toBe("1ère Littéraire");
    expect(formatOperationalStudentClassName({ ...student, classId: "other", option: "Littéraire" }, [parent, literaryA])).toBe("1ère Littéraire");
    expect(formatOperationalStudentClassName({ ...student, classOptionKey: schoolClassOptionKey(parent.id, "Sciences"), option: "Sciences" }, [parent, literaryA])).toBe("1ère Sciences");
  });

  it("affiche les sous-classes CTEB et Humanités comme classes opérationnelles distinctes", () => {
    const cteb = base("cteb-7", { name: "7ème CTEB" });
    const ctebA = base("cteb-7-a", { name: "7ème CTEB - A", parentClassId: cteb.id, subClassLabel: "A" });
    const humanity = base("humanity-1", { name: "1ère Humanité", section: "Secondaire" });
    const literaryKey = schoolClassOptionKey(humanity.id, "Littéraire");
    const literaryA = base("literary-a", { name: "1ère Humanité - Littéraire - A", parentClassId: humanity.id, classOptionKey: literaryKey, subClassLabel: "A" });
    const classes = [cteb, ctebA, humanity, literaryA];
    expect(formatOperationalStudentClassName({ schoolId: "school-a", schoolYearId: "year-a", classId: cteb.id, subClassId: ctebA.id, className: "7ème CTEB" }, classes)).toBe("7ème CTEB A");
    expect(formatOperationalStudentClassName({ schoolId: "school-a", schoolYearId: "year-a", classId: humanity.id, subClassId: literaryA.id, classOptionKey: literaryKey, className: "1ère Humanité", option: "Littéraire" }, classes)).toBe("1ère Littéraire A");
  });

  it("la sauvegarde canonise classId avant de persister subClassId", () => {
    const module = fs.readFileSync("src/modules/students/StudentsModule.tsx", "utf8");
    expect(module).toContain("const selectedClass = resolveStudentParentClass(structuredClasses, form)");
    expect(module).toContain("if (selectedClass) student.classId = selectedClass.id");
  });
});

describe("identite operationnelle stable des classes", () => {
  const commercial = base("commerciale-a", { name: "1ere Humanite", parentClassId: "secondary-1", classOptionKey: schoolClassOptionKey("secondary-1", "Commerciale"), subClassLabel: "A" });
  const literary = base("litteraire-a", { name: "1ere Humanite", parentClassId: "secondary-1", classOptionKey: schoolClassOptionKey("secondary-1", "Litteraire"), subClassLabel: "A" });

  it("distingue deux options et sous-classes homonymes", () => {
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: "secondary-1", subClassId: "commerciale-a", classOptionKey: commercial.classOptionKey, option: "Commerciale" };
    expect(studentBelongsToOperationalClass(student, commercial)).toBe(true);
    expect(studentBelongsToOperationalClass(student, literary)).toBe(false);
  });

  it("refuse une classe d'une autre ecole ou annee", () => {
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: "secondary-1", subClassId: "commerciale-a" };
    expect(studentBelongsToOperationalClass(student, { ...commercial, schoolId: "school-b" })).toBe(false);
    expect(studentBelongsToOperationalClass(student, { ...commercial, schoolYearId: "year-b" })).toBe(false);
  });

  it("conserve une classe active sans eleve et retire une classe desactivee au recalcul", () => {
    expect(operationalSchoolClasses([base("active-empty"), base("inactive", { active: false })], "school-a", "year-a").map((item) => item.id)).toEqual(["active-empty"]);
    expect(operationalSchoolClasses([base("active-empty", { active: false })], "school-a", "year-a")).toEqual([]);
  });
});

describe("clé d'option pendant le chargement des classes", () => {
  it("conserve la clé issue du classId avant le premier snapshot", () => {
    expect(studentSchoolClassOptionKey([], {
      schoolId: "school-a",
      schoolYearId: "year-a",
      classId: "humanities-1",
      className: "1ère Humanité",
      option: "Sciences",
    })).toBe("humanities-1::sciences");
  });

  it("résout l'identifiant de la classe chargée pour une inscription legacy", () => {
    expect(studentSchoolClassOptionKey([base("humanities-1", { name: "1ère Humanité" })], {
      schoolId: "school-a",
      schoolYearId: "year-a",
      className: "1ère Humanité",
      option: "Commerciale",
    })).toBe("humanities-1::commerciale");
  });
});

describe("source canonique partagée entre élèves, vacations et homogénéité", () => {
  const student = (extra: Record<string, unknown>) => ({
    id: "student", schoolId: "school-a", schoolYearId: "year-a", matricule: "M", nom: "N", postnom: "P", prenom: "R",
    sexe: "F" as const, birthDate: "2010-01-01", address: "", phone: "", className: "1ère Humanité" as const, ...extra,
  });

  it("students class display, vacation classes and age-homogeneity classes share the same canonical class identities", () => {
    const classes = [base("primary", { name: "2ème Primaire", section: "Primaire" }), base("inactive", { name: "4ème Primaire", active: false })];
    const result = canonicalOperationalClasses(classes, [student({ option: "Scientifique", section: "Secondaire" })], "school-a", "year-a");
    expect(result.map((item) => item.name)).toEqual(["1ère Scientifique", "2ème Primaire"]);
    expect(studentBelongsToOperationalClass(student({ option: "Scientifique" }), result[0])).toBe(true);
  });

  it("recalcule l’union des sections et retire immédiatement une section", () => {
    const classes = [base("primary", { name: "2ème Primaire", section: "Primaire" }), base("secondary", { name: "1ère Humanité", section: "Secondaire" })];
    expect(canonicalOperationalClasses(classes, [], "school-a", "year-a", ["Primaire", "Secondaire"]).map((item) => item.id)).toEqual(["secondary", "primary"]);
    expect(canonicalOperationalClasses(classes, [], "school-a", "year-a", ["Secondaire"]).map((item) => item.id)).toEqual(["secondary"]);
  });
});

describe("secondary class plus option resolution", () => {
  const student = (extra: Record<string, unknown>) => ({
    id: "student", schoolId: "school-a", schoolYearId: "year-a", matricule: "M", nom: "N", postnom: "P", prenom: "R",
    sexe: "F" as const, birthDate: "2010-01-01", address: "", phone: "", className: "1ère Humanité" as const, section: "Secondaire" as const, ...extra,
  });

  it("secondary operational classes use class plus option instead of generic Humanité parent", () => {
    const parent = base("secondary-1", { name: "1ère Humanité", section: "Secondaire" });
    const classes = [
      parent,
      base("secondary-1-literary", { name: "1ère Humanité", section: "Secondaire", option: "Littéraire", parentClassId: parent.id, classOptionKey: schoolClassOptionKey(parent.id, "Littéraire") }),
      base("secondary-1-commercial", { name: "1ère Humanité", section: "Secondaire", option: "Commerciale", parentClassId: parent.id, classOptionKey: schoolClassOptionKey(parent.id, "Commerciale") }),
    ];
    expect(canonicalOperationalClasses(classes, [], "school-a", "year-a", ["Secondaire"]).map((item) => item.name)).toEqual(["1ère Commerciale", "1ère Littéraire"]);
  });

  it("resolves a legacy option and never invents a missing option", () => {
    expect(canonicalOperationalClasses([], [student({ className: "2ème Humanité", option: "Littéraire", classId: undefined })], "school-a", "year-a", ["Secondaire"]).map((item) => item.name)).toEqual(["2ème Littéraire"]);
    expect(canonicalOperationalClasses([], [student({ className: "2ème Humanité", option: undefined, classId: undefined })], "school-a", "year-a", ["Secondaire"]).map((item) => item.name)).toEqual(["2ème Humanité"]);
  });

  it("matches a legacy option to its structured secondary parent without treating it as a subclass", () => {
    const parent = base("secondary-2", { name: "2ème Humanité", section: "Secondaire" });
    const legacy = student({ classId: parent.id, className: parent.name, option: "Scientifique", classOptionKey: undefined });
    const classes = canonicalOperationalClasses([parent], [legacy], "school-a", "year-a", ["Secondaire"]);
    expect(classes.map((item) => item.name)).toEqual(["2ème Scientifique"]);
    const scientific = classes.find((item) => item.name === "2ème Scientifique")!;
    expect(studentBelongsToOperationalClass(legacy, scientific)).toBe(true);
  });

  it("keeps the canonical option when enrolled classes are filtered for assignments", () => {
    const parent = base("secondary-2", { name: "2ème Humanité", section: "Secondaire" });
    const legacy = student({ classId: parent.id, className: parent.name, option: "Littéraire", classOptionKey: undefined });
    const canonical = canonicalOperationalClasses([parent], [legacy], "school-a", "year-a", ["Secondaire"]);
    expect(classesWithEnrolledStudents(canonical, [legacy], "school-a", "year-a").map((item) => item.name)).toEqual(["2ème Littéraire"]);
  });

  it("does not restore the generic parent when legacy optioned and unoptioned students coexist", () => {
    const parent = base("secondary-1", { name: "1ère Humanité", section: "Secondaire" });
    const scientific = student({ id: "scientific", classId: undefined, className: parent.name, option: "Scientifique", classOptionKey: undefined });
    const legacyParent = student({ id: "legacy-parent", classId: parent.id, className: parent.name, option: undefined });
    const canonical = canonicalOperationalClasses([parent], [scientific, legacyParent], "school-a", "year-a", ["Secondaire"]);
    expect(canonical.map((item) => item.name)).toEqual(["1ère Scientifique"]);
    expect(classesWithEnrolledStudents(canonical, [scientific, legacyParent], "school-a", "year-a").map((item) => item.name)).toEqual(["1ère Scientifique"]);
  });

  it("recovers option metadata from a previously materialized deterministic class id", () => {
    const parent = base("secondary-1", { name: "1ère Humanité", section: "Secondaire" });
    const materialized = base(schoolClassOptionKey(parent.id, "Scientifique"), { name: "1ère Scientifique", section: undefined, option: undefined, parentClassId: undefined, classOptionKey: undefined });
    const operational = operationalSchoolClasses([parent, materialized], "school-a", "year-a", ["Secondaire"]);
    expect(operational).toEqual([
      expect.objectContaining({ id: materialized.id, name: "1ère Scientifique", section: "Secondaire", option: "scientifique", parentClassId: parent.id, classOptionKey: materialized.id }),
    ]);
    const scientific = student({ id: "scientific", classId: undefined, className: parent.name, option: "Scientifique", classOptionKey: undefined });
    expect(classesWithEnrolledStudents(operational, [scientific], "school-a", "year-a").map((item) => item.name)).toEqual(["1ère Scientifique"]);
  });

  it("inherits only legacy parent vacations and preserves an explicit operational vacation", () => {
    const parent = base("secondary-1", {
      name: "1ère Humanité",
      section: "Secondaire",
      vacation: "afternoon",
      saturdayEnabled: true,
      saturdayVacation: "morning",
    });
    const optionId = schoolClassOptionKey(parent.id, "Commerciale");
    const materialized = base(optionId, {
      name: "1ère Commerciale",
      parentClassId: parent.id,
      classOptionKey: optionId,
      option: "Commerciale",
      vacation: "morning",
    });
    const enrolled = student({ classId: parent.id, option: "Commerciale", classOptionKey: optionId });

    expect(operationalSchoolClasses([parent, materialized], "school-a", "year-a", ["Secondaire"])[0]).toMatchObject({
      id: optionId,
      vacation: "morning",
      saturdayEnabled: true,
      saturdayVacation: "morning",
    });
    expect(canonicalOperationalClasses([parent], [enrolled], "school-a", "year-a", ["Secondaire"])[0]).toMatchObject({
      id: optionId,
      vacation: "afternoon",
      saturdayEnabled: true,
      saturdayVacation: "morning",
    });
  });

  it("inherits the parent vacation for a certain legacy materialized option", () => {
    const parent = base("secondary-1", { name: "1ère Humanité", section: "Secondaire", vacation: "afternoon" });
    const optionId = schoolClassOptionKey(parent.id, "Commerciale");
    const legacy = base(optionId, { name: "1ère Commerciale", section: undefined, vacation: "morning" });
    expect(operationalSchoolClasses([parent, legacy], "school-a", "year-a", ["Secondaire"])[0]).toMatchObject({
      id: optionId,
      parentClassId: parent.id,
      classOptionKey: optionId,
      option: "commerciale",
      vacation: "afternoon",
    });
  });

  it("preserves the vacation of a materialized option class reconciled by a secondary enrolment", () => {
    const classId = schoolClassOptionKey("secondary-1", "Littéraire");
    const materialized = base(classId, {
      name: "1ère Littéraire",
      section: undefined,
      option: undefined,
      parentClassId: undefined,
      classOptionKey: undefined,
      vacation: "afternoon",
    });
    const enrolled = student({
      id: "literary",
      classId: "secondary-1",
      className: "1ère Humanité",
      option: "Littéraire",
      classOptionKey: classId,
      section: "Secondaire",
    });

    expect(canonicalOperationalClasses([materialized], [enrolled], "school-a", "year-a", ["Secondaire"])).toEqual([
      expect.objectContaining({
        id: classId,
        name: "1ère Littéraire",
        section: "Secondaire",
        vacation: "afternoon",
      }),
    ]);
  });

  it("keeps literary and commercial identities separate in filters, homogeneity and vacations", () => {
    const literary = student({ id: "literary", option: "Littéraire" });
    const commercial = student({ id: "commercial", option: "Commerciale" });
    const classes = canonicalOperationalClasses([], [literary, commercial], "school-a", "year-a", ["Secondaire"]);
    expect(classes.map((item) => item.name)).toEqual(["1ère Commerciale", "1ère Littéraire"]);
    const literaryClass = classes.find((item) => item.name === "1ère Littéraire")!;
    expect(studentBelongsToOperationalClass(literary, literaryClass)).toBe(true);
    expect(studentBelongsToOperationalClass(commercial, literaryClass)).toBe(false);
  });
});

describe("classes réellement utilisées par les élèves", () => {
  const classes = [
    base("7", { name: "7ème CTEB" }),
    base("7a", { name: "7ème CTEB - A", parentClassId: "7", subClassLabel: "A" }),
    base("7b", { name: "7ème CTEB - B", parentClassId: "7", subClassLabel: "B" }),
    base("8", { name: "8ème CTEB" }),
    base("empty", { name: "9ème CTEB" }),
  ];
  const student = (extra: Record<string, string | undefined>) => ({ schoolId: "school-a", schoolYearId: "year-a", ...extra });

  it("résout classId et exclut une classe sans élève", () => expect(classesWithEnrolledStudents(classes, [student({ classId: "8", className: "8ème CTEB" })], "school-a", "year-a").map((item) => item.id)).toEqual(["8"]));
  it("conserve un className legacy et le résout vers la classe structurée", () => expect(classesWithEnrolledStudents(classes, [student({ className: "8ème CTEB" })], "school-a", "year-a").map((item) => item.id)).toEqual(["8"]));
  it("conserve un className legacy sans document classe avec un identifiant tenanté", () => expect(classesWithEnrolledStudents(classes, [student({ className: "Classe historique" })], "school-a", "year-a")[0]).toMatchObject({ id: "school-a__year-a__classe-historique", name: "Classe historique", schoolId: "school-a", schoolYearId: "year-a" }));
  it("préfère subClassId à la classe principale", () => expect(classesWithEnrolledStudents(classes, [student({ classId: "7", subClassId: "7a", className: "7ème CTEB" })], "school-a", "year-a").map((item) => item.id)).toEqual(["7a"]));
  it("déduplique et trie naturellement les classes", () => expect(classesWithEnrolledStudents(classes, [student({ classId: "8" }), student({ classId: "8" }), student({ subClassId: "7b" }), student({ subClassId: "7a" })], "school-a", "year-a").map((item) => item.id)).toEqual(["7a", "7b", "8"]));
  it("exclut les élèves d’une autre école ou année", () => expect(classesWithEnrolledStudents(classes, [{ schoolId: "school-b", schoolYearId: "year-a", classId: "8" }, { schoolId: "school-a", schoolYearId: "year-b", classId: "8" }], "school-a", "year-a")).toEqual([]));
  it("recalcule la liste lorsqu’un nouvel élève arrive du listener", () => { const before = classesWithEnrolledStudents(classes, [student({ classId: "8" })], "school-a", "year-a"); const after = classesWithEnrolledStudents(classes, [student({ classId: "8" }), student({ classId: "empty" })], "school-a", "year-a"); expect(before.map((item) => item.id)).toEqual(["8"]); expect(after.map((item) => item.id)).toEqual(["8", "empty"]); });
});
