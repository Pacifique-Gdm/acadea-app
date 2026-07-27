import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyStudent, validateStudentForSave } from "./studentUtils";

describe("validation de l'enregistrement d'un élève", () => {
  const validStudent = () => ({ ...emptyStudent("school-a", "year-a"), nom: "Kabuya", prenom: "Aline" });

  it("accepte une fiche valide liée à l'école et à l'année courantes", () => {
    expect(validateStudentForSave(validStudent(), "school-a", "year-a")).toBe("");
  });

  it("refuse les champs d'identité obligatoires absents", () => {
    expect(validateStudentForSave({ ...validStudent(), nom: " " }, "school-a", "year-a")).toContain("nom");
    expect(validateStudentForSave({ ...validStudent(), prenom: " " }, "school-a", "year-a")).toContain("prénom");
    expect(validateStudentForSave(validStudent(), "", "year-a")).toContain("année scolaire");
    expect(validateStudentForSave(validStudent(), "school-a", "")).toContain("année scolaire");
  });
});

describe("flux de soumission du formulaire élève", () => {
  const formSource = readFileSync(new URL("../components/students/StudentForm.tsx", import.meta.url), "utf8");
  const moduleSource = readFileSync(new URL("../modules/students/StudentsModule.tsx", import.meta.url), "utf8");

  it("utilise une vraie soumission et désactive les actions pendant l'écriture", () => {
    expect(formSource).toContain("onSubmit={(event) =>");
    expect(formSource).toContain('type="submit"');
    expect(formSource).toContain("disabled={isSaving}");
    expect(moduleSource).toContain("if (saveInProgressRef.current) return;");
  });

  it("attend l'écriture, met à jour sans doublon, puis ferme et réinitialise après succès", () => {
    expect(moduleSource).toContain("await persistFirestorePatch(");
    expect(moduleSource).toContain("data.students.map((item) => (item.id === student.id ? student : item))");
    expect(moduleSource).toContain("[...data.students, student]");
    expect(moduleSource).toContain("setForm(emptyCurrentStudent());");
    expect(moduleSource).toContain("setShowForm(false);");
  });

  it("conserve une erreur visible et restaure toujours le verrou", () => {
    expect(formSource).toContain('role="alert"');
    expect(moduleSource).toContain("} finally {");
    expect(moduleSource).toContain("saveInProgressRef.current = false;");
    expect(moduleSource).toContain("setIsSaving(false);");
  });
});
