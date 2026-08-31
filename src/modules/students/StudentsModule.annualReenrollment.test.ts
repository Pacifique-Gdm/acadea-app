import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StudentsModule.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../../components/students/ArchivedStudentsImportDrawer.tsx", import.meta.url), "utf8");
const provisioning = readFileSync(new URL("../../services/provisioning.ts", import.meta.url), "utf8");

describe("réinscription annuelle terminale dans les archives", () => {
  it("réserve l'action aux rôles Administrateur et Secrétaire dans une année archivée", () => {
    expect(source).toContain('year.status === "archived"');
    expect(source).toContain('["school_admin", "secretary"].includes(user.role)');
    expect(source).toContain('canonicalAnnualClassName(student.className) !== "4ème Humanité"');
    expect(source).toContain("isEligibleForAnnualTransition(student)");
  });
  it("exige une année active, une classe structurée et masque un élève déjà réinscrit", () => {
    expect(source).toContain("hasTerminalTargetClass");
    expect(source).toContain("activeTargetYear");
    expect(source).toContain("item.importedFromStudentId === student.id");
    expect(source).toContain("studentImportKey(item) === studentImportKey(student)");
  });
  it("affiche une action accessible et une confirmation explicite", () => {
    expect(source).toContain('label="Réinscrire en 4ème Humanité"');
    expect(source).toContain('title="Réinscrire l’élève"');
    expect(source).toContain('placeholder="REINSCRIRE CET ELEVE"');
    expect(source).toContain('terminalConfirmation !== "REINSCRIRE CET ELEVE"');
  });
  it("appelle l'action de provisioning existante sans endpoint supplémentaire", () => {
    expect(provisioning).toContain('action: "reenroll-terminal-student"');
    expect(source).toContain("requestTerminalStudentReenrollment");
  });
});

describe("feedback de la transition annuelle", () => {
  it("distingue promotions, fins de cycle et élèves non réimportés", () => {
    for (const field of ["promotedCount", "terminalExitCount", "schoolCycleExitCount", "skippedCount"]) expect(drawer).toContain(field);
    expect(drawer).toContain("Transition terminée");
  });
  it("déclare explicitement les historiques jamais copiés", () => {
    for (const label of ["Paiements", "présences", "notes", "cotes", "sanctions", "messages"]) expect(drawer).toContain(label);
  });
});
