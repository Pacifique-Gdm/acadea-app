import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const moduleSource = readFileSync("src/modules/studies/StudyTeachersModule.tsx", "utf8");
const serviceSource = readFileSync("src/modules/studies/studyService.ts", "utf8");

describe("StudyTeachers assignment editor contract", () => {
  it("retire la colonne ACTION et affiche la titularité dans la liste des enseignants", () => {
    expect(moduleSource).toContain('["Nom", "Matières", "Classes", "Titulaire de la classe", "Affectations", "Charge", "Statut"]');
    expect(moduleSource).not.toContain('"Action"');
    expect(moduleSource).not.toContain(">Affecter</button>");
    expect(moduleSource).toContain('onClick={() => setSelectedTeacher(teacher)}');
    expect(moduleSource).toContain("Configurer disponibilité");
    expect(moduleSource).toContain("Fiche pédagogique");
    expect(moduleSource).toContain("colSpan={7}");
  });

  it("uses the same enabled multi-select controls for create and edit", () => {
    expect(moduleSource).toContain('MultiSelectDropdown label="Cours"');
    expect(moduleSource).toContain('MultiSelectDropdown label="Classes"');
    expect(moduleSource).not.toContain("disabled={Boolean(editingAssignment)}");
  });

  it("pre-fills current teacher, course, class and functional values", () => {
    expect(moduleSource).toContain("setTeacherId(nextTeacherId)");
    expect(moduleSource).toContain("setSubjectIds(current?.subjectId ? [current.subjectId] : [])");
    expect(moduleSource).toContain("setClassIds(currentBaseClassId ? [currentBaseClassId] : [])");
    expect(moduleSource).toContain("normalizedAssignmentScope(current, assignmentScopeClasses)");
    expect(moduleSource).toContain("setWeeklyPeriods(String(current?.weeklyPeriods ?? 1))");
    expect(moduleSource).toContain("setTitularClassIds(current ? data.titulars.filter");
  });

  it("derives sections from the selected teacher and removes manual section selection", () => {
    expect(moduleSource).toContain("userSectionIds(selectedAssignmentTeacher ?? {})");
    expect(moduleSource).toContain("teacherSections.includes(studyClassSection(item))");
    expect(moduleSource).toContain("Section(s) attribuée(s) :");
    expect(moduleSource).not.toContain(">Section<select");
    expect(moduleSource).toContain("teacherSections.length === 0");
  });

  it("keeps the pedagogical drawer actions full width without redundant headings", () => {
    expect(moduleSource).toContain("Ajouter affectation");
    expect(moduleSource).toContain("Configurer disponibilité");
    expect(moduleSource).toContain("primary-button w-full justify-center");
    expect(moduleSource).not.toContain(">Affectations</h3>");
    expect(moduleSource).not.toContain(">Disponibilités</h3>");
  });

  it("submits every selected course/class combination through one transactional service", () => {
    expect(moduleSource).toContain("subjectIds: savedSubjectIds, classIds: savedClassIds");
    expect(moduleSource).toContain("current: editingAssignment");
    expect(serviceSource).toContain("const targetIds = new Set(targets.map");
    expect(serviceSource).toContain('"pedagogicalAssignmentLocks"');
    expect(serviceSource).toContain("transaction.update(doc(database, \"pedagogicalAssignments\", input.current.id)");
    expect(serviceSource).toContain("combinations.forEach(({ subjectId, classId, courseScope, targetOptionIds, studentGroupKey })");
    expect(moduleSource).toContain('Type de cours');
    expect(moduleSource).toContain('Tronc commun');
    expect(moduleSource).toContain('Cours d’option');
  });

  it("keeps deterministic duplicate protection and the raw/canonical class distinction", () => {
    expect(moduleSource).toContain("hasActiveSubjectClassConflict(assignments, candidate, editingAssignment?.id)");
    expect(moduleSource).toContain("!sourceClasses.some((current) => current.id === item.id)");
  });
  it("renomme la source canonique avec une confirmation exacte vide par défaut", () => {
    expect(moduleSource).toContain("renameStudySubject({ user, schoolId: school.id, schoolYearId: year.id");
    expect(moduleSource).toContain('setRenameConfirmation("")');
    expect(moduleSource).toContain("SUBJECT_RENAME_CONFIRMATION");
    expect(moduleSource).toContain("subjectRenameConfirmed(renameConfirmation)");
  });
});
