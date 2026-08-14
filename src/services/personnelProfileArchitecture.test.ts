import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("architecture de la fiche individuelle", () => {
  it("préserve strictement les six champs du formulaire de création", () => {
    const source = readFileSync("src/modules/menu/MenuModule.tsx", "utf8");
    ["Type d'utilisateur", "Sections", "Nom complet", "Téléphone", "Email", "Mot de passe temporaire"].forEach((label) => expect(source).toContain(label));
    expect(source.slice(source.indexOf('sectionId === "personnel"'), source.indexOf('sectionId === "fees"'))).not.toContain("Date de naissance");
  });

  it("utilise un profil séparé, une allocation atomique et aucune donnée sensible dans users", () => {
    const api = readFileSync("api/provision-school-account.js", "utf8");
    expect(api).toContain("db.runTransaction");
    expect(api).toContain("personnelProfiles/${personnelId}");
    expect(api).toContain("PER-${String(next).padStart(6, \"0\")}");
    expect(api).toContain("createdAt: existing?.createdAt ?? now");
  });

  it("interdit les écritures client du profil et isole les photos", () => {
    const firestore = readFileSync("firestore.rules", "utf8");
    const storage = readFileSync("storage.rules", "utf8");
    expect(firestore).toContain("match /personnelProfiles/{personnelId}");
    expect(firestore).toContain("allow create, update, delete: if false");
    expect(storage).toContain("match /personnel-photos/{schoolId}/{personnelId}/{fileName}");
    expect(storage).toContain("tenantSchoolId() == schoolId");
  });

  it("nettoie la nouvelle photo si l’API échoue et l’ancienne seulement après succès", () => {
    const source = readFileSync("src/modules/menu/PersonnelDrawerContent.tsx", "utf8");
    expect(source).toContain("if (uploaded.photoPath) await deletePersonnelPhoto(uploaded.photoPath)");
    expect(source.indexOf("await updatePersonnel")).toBeLessThan(source.indexOf("await deletePersonnelPhoto(profile?.photoPath)"));
  });
});
