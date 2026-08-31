import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { emptyStudent, studentForPersistence } from "./studentUtils";
import { importedStudentDocument } from "../../api/_lib/archivedStudentsImport.js";
import { ANNUAL_TRANSITION_RESULTS, annualStudentTransition, canonicalAnnualClassName, isEligibleForAnnualTransition, studentImportKey } from "./studentYearTransition.js";

describe("normalisation commune des élèves et transition annuelle", () => {
  it("retire récursivement les optionnels absents sans altérer les valeurs intentionnelles", () => {
    const date = new Date("2026-01-01"), timestamp = Timestamp.fromDate(date);
    const payload = studentForPersistence({ option: undefined, phone: "", photo: null, nested: { absent: undefined, date, timestamp, items: [{ absent: undefined, present: 0 }] } });
    expect(payload).not.toHaveProperty("option");
    expect(payload.nested).not.toHaveProperty("absent");
    expect(payload.nested.items).toEqual([{ present: 0 }]);
    expect(payload).toMatchObject({ phone: "", photo: null });
    expect(payload.nested.date).toBe(date); expect(payload.nested.timestamp).toBe(timestamp);
  });
  it.each(["Maternelle 1", "1ère Primaire", "8ème CTEB"] as const)("importe %s sans option ni références de l'ancienne année", (className) => {
    const source = { ...emptyStudent("s", "old"), id: "x", className, classId: "old-class", subClassId: "old-subclass", classOptionKey: "old-key" };
    const payload = importedStudentDocument(source, "s", "new", []);
    for (const key of ["option", "classId", "subClassId", "classOptionKey"]) expect(payload).not.toHaveProperty(key);
    expect(payload?.annee_scolaire_id).toBe("new");
    expect(source.classId).toBe("old-class");
  });
  it("conserve une option existante et n'invente pas de classe ou de sous-classe cible", () => {
    const source = { ...emptyStudent("s", "old"), id: "x", className: "1ère Humanité" as const, option: "Sciences", classId: "old-class" };
    const payload = importedStudentDocument(source, "s", "new", [{ id: "foreign", schoolId: "other", schoolYearId: "new", name: "2ème Humanité", active: true }]);
    expect(payload).toMatchObject({ className: "2ème Humanité", option: "Sciences" });
    expect(payload).not.toHaveProperty("classId");
  });
  it("utilise un identifiant déterministe et conserve le matricule et le parent", () => {
    const source = { ...emptyStudent("s", "old"), id: "x", matricule: "MAT-001", parentId: "parent" };
    expect(importedStudentDocument(source, "s", "new", [])).toEqual(importedStudentDocument(source, "s", "new", []));
    expect(importedStudentDocument(source, "s", "new", [])).toMatchObject({ matricule: source.matricule, parentId: source.parentId });
  });
  it("normalise la clé de déduplication historique sans convertir aveuglément des objets", () => {
    const student = { ...emptyStudent("s", "y"), matricule: " MAT-001 " };
    expect(studentImportKey(student)).toBe("mat-001");
  });
});

describe("matrice officielle de transition annuelle", () => {
  const transitions = [
    ["Maternelle 1", "Maternelle 2"], ["Maternelle 2", "Maternelle 3"], ["Maternelle 3", "1ère Primaire"],
    ["1ère Primaire", "2ème Primaire"], ["2ème Primaire", "3ème Primaire"], ["3ème Primaire", "4ème Primaire"],
    ["4ème Primaire", "5ème Primaire"], ["5ème Primaire", "6ème Primaire"], ["6ème Primaire", "7ème CTEB"],
    ["7ème CTEB", "8ème CTEB"], ["8ème CTEB", "1ère Humanité"], ["1ère Humanité", "2ème Humanité"],
    ["2ème Humanité", "3ème Humanité"], ["3ème Humanité", "4ème Humanité"],
  ] as const;
  it.each(transitions)("promeut %s vers %s", (source, target) => {
    expect(annualStudentTransition({ className: source, status: "ACTIVE", option: "Sciences" }, true)).toMatchObject({ result: ANNUAL_TRANSITION_RESULTS.PROMOTED, className: target });
  });
  it("laisse l'option vide lors du passage CTEB vers Humanités", () => {
    const result = annualStudentTransition({ className: "8ème CTEB", status: "ACTIVE", option: "Sciences" }, true);
    expect(result).toMatchObject({ result: "PROMOTED", className: "1ère Humanité", optionPending: true });
    expect(result).not.toHaveProperty("option");
  });
  it("termine le cycle en 4ème Humanité sans cible", () => {
    expect(annualStudentTransition({ className: "4ème Humanité", status: "ACTIVE" })).toEqual({ result: "TERMINAL_EXIT", sourceClassName: "4ème Humanité" });
  });
  it.each(["6ème Primaire", "8ème CTEB"] as const)("retourne une fin de cycle établissement si la cible de %s manque", (className) => {
    expect(annualStudentTransition({ className, status: "ACTIVE" }, false).result).toBe("SCHOOL_CYCLE_EXIT");
  });
  it.each(["TRANSFERRED", "DROPPED", "DECEASED"] as const)("ignore le statut %s", (status) => {
    expect(isEligibleForAnnualTransition({ className: "1ère Primaire", status } as never)).toBe(false);
    expect(annualStudentTransition({ className: "1ère Primaire", status }).result).toBe("SKIPPED_INACTIVE");
  });
  it("ignore aussi les fiches legacy supprimées ou désactivées", () => {
    expect(annualStudentTransition({ className: "1ère Primaire", deletedAt: "2026-01-01" }).result).toBe("SKIPPED_INACTIVE");
    expect(annualStudentTransition({ className: "1ère Primaire", active: false }).result).toBe("SKIPPED_INACTIVE");
  });
  it("normalise CTEB/CETB sans accepter une classe inconnue", () => {
    expect(canonicalAnnualClassName(" 8ème CETB ")).toBe("8ème CTEB");
    expect(annualStudentTransition({ className: "Classe inventée" }).result).toBe("INVALID_CLASS");
  });
});
