import { describe, expect, it } from "vitest";
import type { Student } from "../../types";
import { escapePdfHtml } from "../../utils/pdf";
import { medicalRecordSections } from "./medicalRecordFields";
import { medicalRecordPdfSections } from "./medicalRecordPdf";
import type { StudentMedicalRecord } from "./secretaryTypes";

const student = {
  id: "student-1", matricule: "AC-001", nom: "Mbuyi", postnom: "Kabeya", prenom: "Aline", className: "7ème CTEB", sexe: "F", birthDate: "2012-04-05", photoUrl: "https://example.test/photo.jpg",
} as Student;

const record = {
  id: "student-1", studentId: "student-1", schoolId: "school-1", schoolYearId: "year-1", bloodGroup: "O+", rhesus: "+", height: "152 cm", weight: "44 kg", medicalHistory: "Antécédent", allergies: "Arachides", chronicDiseases: "Asthme", currentTreatments: "Traitement", disabilityOrSpecialNeed: "Aucun", vaccinations: "À jour", medicalObservations: "Surveillance", emergencyContactName: "Responsable", emergencyContactPhone: "+243000000", emergencyContactRelationship: "Parent", attendingPhysician: "Dr Test", physicianPhone: "+243111111", referenceHealthCenter: "Centre scolaire", createdBy: "secretary-1", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-30T00:00:00.000Z",
} as StudentMedicalRecord;

describe("PDF de fiche médicale", () => {
  it("reprend l'identité, la photo et tous les champs de la configuration partagée", () => {
    const html = medicalRecordPdfSections(student, record).join("\n");
    for (const section of medicalRecordSections) {
      expect(html).toContain(section.title.toUpperCase());
      for (const field of section.fields) expect(html).toContain(escapePdfHtml(field.label));
    }
    for (const value of ["AC-001", "Mbuyi Kabeya Aline", "7ème CTEB", "Féminin", "Photo de l'élève", "Date de création", "Dernière mise à jour"]) expect(html).toContain(value);
    expect(html).toContain("medical-record-pdf");
    expect(html).not.toContain("SIGNATURE");
    expect(html).not.toContain("Espace réservé à la signature");
    expect(html).not.toContain("border-bottom:1px solid #94a3b8");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });
});
