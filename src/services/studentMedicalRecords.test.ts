import { describe, expect, it } from "vitest";
import { canManageStudentMedicalRecords, cleanMedicalRecordInput, getMedicalRecordStatus, medicalRecordSaveErrorMessage } from "./studentMedicalRecords";
import type { AppUser } from "../types";
import type { StudentMedicalRecord } from "../modules/secretary/secretaryTypes";

const record = {
  bloodGroup: "A", emergencyContactName: "Parent", emergencyContactPhone: "+243", emergencyContactRelationship: "Père",
} as StudentMedicalRecord;

describe("fiches médicales du Secrétaire", () => {
  it("distingue fiche absente, incomplète et complète", () => {
    expect(getMedicalRecordStatus()).toBe("missing");
    expect(getMedicalRecordStatus({ ...record, bloodGroup: "" })).toBe("incomplete");
    expect(getMedicalRecordStatus(record)).toBe("complete");
  });

  it("autorise uniquement Administrateur et Secrétaire actifs de la même école", () => {
    const user = (role: AppUser["role"], schoolId = "school-a", status: AppUser["status"] = "active") => ({ role, schoolId, status } as AppUser);
    expect(canManageStudentMedicalRecords(user("school_admin"), "school-a")).toBe(true);
    expect(canManageStudentMedicalRecords(user("secretary"), "school-a")).toBe(true);
    expect(canManageStudentMedicalRecords(user("cashier"), "school-a")).toBe(false);
    expect(canManageStudentMedicalRecords(user("secretary", "school-b"), "school-a")).toBe(false);
    expect(canManageStudentMedicalRecords(user("secretary", "school-a", "inactive"), "school-a")).toBe(false);
  });

  it("nettoie toutes les valeurs indéfinies avant Firestore", () => {
    expect(cleanMedicalRecordInput({ allergies: undefined, bloodGroup: " A+ " })).toEqual({ allergies: "", bloodGroup: "A+" });
  });

  it("traduit une erreur Firestore de permission", () => {
    expect(medicalRecordSaveErrorMessage({ code: "permission-denied" })).toContain("autorisation");
  });
});
