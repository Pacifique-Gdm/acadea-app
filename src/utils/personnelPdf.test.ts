import { describe, expect, it, vi } from "vitest";
import type { AppUser, PersonnelProfile, School } from "../types";

const renderAcadPdfPreview = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pdf", () => ({
  renderAcadPdfPreview,
  escapePdfHtml: (value: unknown) => String(value ?? ""),
  pdfSection: (title: string, body: unknown, options?: unknown) => ({ title, body, options }),
  pdfTable: (_columns: unknown, rows: unknown) => rows,
}));
import { printPersonnelListPdf, printPersonnelProfilePdf } from "./personnelPdf";

const school = { id: "school-a", name: "École A", address: "Kinshasa", phone: "099", email: "school@example.test" } as School;
const personnel = { id: "teacher-a", name: "Kabeya Ilunga Alice", email: "alice@example.test", phone: "099111", role: "teacher", schoolId: "school-a", sectionIds: ["CTEB"], createdAt: "2024-02-03T00:00:00.000Z" } as AppUser;
const profile: PersonnelProfile = {
  id: "teacher-a", personnelId: "teacher-a", schoolId: "school-a", matricule: "PER-000001",
  lastName: "Kabeya", middleName: "Ilunga", firstName: "Alice", jobTitle: "Professeure",
  gender: "F", birthDate: "1990-05-04", birthPlace: "Kinshasa", address: "Gombe",
  engagementDate: "2020-09-01", contractType: "CDI", educationLevel: "Licence", diploma: "Licence en pédagogie",
  specialty: "Mathématiques", trainingInstitution: "ISP", graduationYear: 2014,
  emergencyContactName: "Paul Kabeya", emergencyContactRelationship: "Frère", emergencyContactPhone: "099222",
  observations: "Ponctuelle et rigoureuse.", createdAt: "2026-01-01", createdBy: "admin", updatedAt: "2026-01-01", updatedBy: "admin",
};

describe("fiche individuelle du personnel", () => {
  it("respecte l'ordre strict des rubriques et tous les libellés métier", async () => {
    await printPersonnelProfilePdf(school, personnel, profile);
    const options = renderAcadPdfPreview.mock.calls.at(-1)?.[0];
    expect(options).toEqual(expect.objectContaining({ title: "FICHE INDIVIDUELLE DU PERSONNEL", centerDocumentTitle: true, showGeneratedAt: false, school }));
    expect(options.sections.slice(0, 6).map((section: { title: string }) => section.title)).toEqual([
      "IDENTIFICATION", "COORDONNÉES", "SITUATION PROFESSIONNELLE", "FORMATION ET QUALIFICATIONS", "INFORMATIONS COMPLÉMENTAIRES", "OBSERVATIONS",
    ]);
    const serialized = JSON.stringify(options);
    ["Matricule", "Nom", "Postnom", "Prénom", "Sexe", "Date et lieu de naissance", "Téléphone", "E-mail", "Adresse", "Fonction", "Date d’engagement", "Type de contrat", "Sections", "Statut", "Niveau d’études", "Diplôme", "Spécialité", "Établissement", "Année d’obtention", "Personne à contacter", "Lien avec la personne", "OBSERVATIONS", "Signature du personnel", "Signature / Cachet de l’établissement"].forEach((label) => expect(serialized).toContain(label));
    expect(serialized).not.toMatch(/Service/);
  });

  it("utilise exclusivement users.createdAt et exclut année scolaire, mot de passe et identifiants internes visibles", async () => {
    await printPersonnelProfilePdf(school, personnel, { ...profile, photoUrl: "https://example.test/photo.jpg" });
    const options = renderAcadPdfPreview.mock.calls.at(-1)?.[0];
    const visibleHtml = JSON.stringify(options.sections);
    expect(visibleHtml).toContain("03/02/2024");
    expect(visibleHtml).not.toContain("01/01/2026");
    expect(visibleHtml).not.toMatch(/année scolaire|mot de passe|schoolId|teacher-a/i);
    expect(visibleHtml).not.toMatch(/undefined|null|NaN|\[object Object\]/);
  });

  it("conserve une zone photo à droite avec ou sans photo et un ratio non étiré", async () => {
    await printPersonnelProfilePdf(school, personnel, { ...profile, photoUrl: "https://example.test/photo.jpg" });
    expect(JSON.stringify(renderAcadPdfPreview.mock.calls.at(-1)?.[0].sections[0])).toContain("personnel-photo-box");
    expect(JSON.stringify(renderAcadPdfPreview.mock.calls.at(-1)?.[0].sections[0])).toContain("photo.jpg");
    await printPersonnelProfilePdf(school, personnel, profile);
    expect(JSON.stringify(renderAcadPdfPreview.mock.calls.at(-1)?.[0].sections[0])).toContain("Photo non renseignée");
  });

  it("rend les observations longues en pleine largeur et active la pagination", async () => {
    const observations = "Observation professionnelle longue\n".repeat(40);
    await printPersonnelProfilePdf(school, personnel, { ...profile, observations });
    const options = renderAcadPdfPreview.mock.calls.at(-1)?.[0];
    expect(options.singlePageFit).toBe(false);
    expect(options.sections[5]).toEqual(expect.objectContaining({ title: "OBSERVATIONS", body: expect.stringContaining(observations) }));
    expect(JSON.stringify(options.sections[0])).not.toContain(observations);
  });

  it("reste compatible avec un ancien personnel qui n'a qu'un nom complet", async () => {
    await printPersonnelProfilePdf(school, { ...personnel, name: "Ancien Personnel" }, undefined);
    const html = JSON.stringify(renderAcadPdfPreview.mock.calls.at(-1)?.[0].sections);
    expect(html).toContain("Ancien Personnel");
    expect(html).not.toMatch(/undefined|null/);
  });

  it("conserve l'institution Coordination en en-tête et l'école du personnel dans le corps", async () => {
    const coordinationInstitution = { ...school, id: "coord-a", name: "Coordination X", logoUrl: "coordination-logo" };
    await printPersonnelProfilePdf(coordinationInstitution, personnel, profile, new Date("2026-08-22T10:00:00Z"), { personnelSchoolName: "École A" });
    const options = renderAcadPdfPreview.mock.calls.at(-1)?.[0];
    expect(options.school).toEqual(coordinationInstitution);
    expect(JSON.stringify(options.sections)).toContain("École A");
  });
});

describe("liste filtrée du personnel", () => {
  it("imprime exactement le tableau actif fourni par l'interface", async () => {
    await printPersonnelListPdf(school, [personnel], "active", new Date("2026-08-14T12:00:00Z"));
    const options = renderAcadPdfPreview.mock.calls.at(-1)?.[0];
    expect(options).toEqual(expect.objectContaining({ title: "Liste du personnel actif", school }));
    expect(JSON.stringify(options)).toContain("teacher-a");
  });
});
