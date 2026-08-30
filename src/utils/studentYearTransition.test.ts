import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { emptyStudent, studentForPersistence } from "./studentUtils";
import { importedStudentDocument } from "../../api/_lib/archivedStudentsImport.js";
import { studentImportKey } from "./studentYearTransition.js";

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
    expect(payload.annee_scolaire_id).toBe("new");
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
