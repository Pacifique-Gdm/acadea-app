import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MenuModule.tsx", import.meta.url), "utf8");

describe("formulaire de création des utilisateurs métier", () => {
  it("bloque les doubles soumissions et conserve le formulaire en cas d'échec", () => {
    expect(source).toContain("if (schoolUserSubmitting) return;");
    expect(source).toContain("disabled={schoolUserSubmitting");
    const catchBlock = source.slice(source.indexOf("} catch (error) {", source.indexOf("async function saveSchoolUser")), source.indexOf("} finally {", source.indexOf("async function saveSchoolUser")));
    expect(catchBlock).not.toContain("setCashierName(\"\")");
    expect(catchBlock).not.toContain("setCashierPhone(\"\")");
  });

  it("synchronise le mot de passe avec le téléphone et régénère l'email au changement de rôle", () => {
    expect(source).toContain("temporaryPasswordAfterPhoneChange");
    expect(source).toContain("setSchoolUserPasswordManuallyEdited(true)");
    expect(source).toContain("setSchoolUserEmailManuallyEdited(false)");
    expect(source).toContain("nextSchoolStaffEmail(school, schoolUserRole");
  });

  it("conserve la restriction school_admin existante", () => {
    expect(source).toContain('const canAdmin = user.role === "school_admin"');
    expect(source).toContain('sectionId === "accounts" && canAdmin');
  });

  it("propose le rôle Enseignant dans le formulaire existant", () => {
    expect(source).toContain('<option value="teacher">Enseignant</option>');
    expect(source).toContain('teacher: "Enseignant"');
    expect(source.match(/Créer un utilisateur/g)).toHaveLength(1);
  });
});
