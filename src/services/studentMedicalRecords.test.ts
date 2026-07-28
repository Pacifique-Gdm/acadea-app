import { describe, expect, it } from "vitest";
import { getMedicalRecordStatus } from "./studentMedicalRecords";
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
});
