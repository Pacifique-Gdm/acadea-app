import { describe, expect, it } from "vitest";
import type { AppUser, ParentProfile, School } from "../types";
import { isValidProvisioningPhone, nextSchoolStaffEmail, normalizeSchoolEmailDomain, schoolStaffEmailPrefixes } from "./schoolAccountCredentials";
import { nextParentEmail, parentEmailDomain } from "./parents";

const school = { id: "school-1", name: "Complexe Scolaire La Grâce", acronym: "CSLG" } as School;
const user = (email: string) => ({ id: email, schoolId: school.id, email } as AppUser);

describe("identifiants temporaires des comptes métier", () => {
  it.each([
    ["cashier", "caissier001@cslg.com"],
    ["secretary", "secretaire001@cslg.com"],
    ["discipline_director", "discipline001@cslg.com"],
    ["study_director", "etudes001@cslg.com"],
    ["teacher", "enseignant001@cslg.com"],
  ] as const)("génère l'adresse attendue pour %s", (role, expected) => {
    expect(nextSchoolStaffEmail(school, role, [], [])).toBe(expected);
  });

  it("normalise accents, espaces, apostrophes et caractères spéciaux", () => {
    expect(normalizeSchoolEmailDomain("École Sainte-Marie d’Espérance !")).toBe("ecolesaintemariedesperance.com");
    for (const acronym of ["CSL", "C.S.L", "C S L", "csl"]) {
      expect(nextSchoolStaffEmail({ ...school, acronym }, "teacher", [], [])).toBe("enseignant001@csl.com");
      expect(parentEmailDomain({ ...school, acronym })).toBe("csl.com");
    }
  });

  it("passe à 002 sans doublon, y compris avec un parent existant", () => {
    const parents = [{ email: "CAISSIER001@CSLG.COM" }] as ParentProfile[];
    expect(nextSchoolStaffEmail(school, "cashier", [], parents)).toBe("caissier002@cslg.com");
  });

  it("change de préfixe selon le rôle", () => {
    expect(schoolStaffEmailPrefixes).toEqual({ cashier: "caissier", secretary: "secretaire", discipline_director: "discipline", study_director: "etudes", teacher: "enseignant" });
    expect(nextSchoolStaffEmail(school, "secretary", [user("caissier001@cslg.com")], [])).toBe("secretaire001@cslg.com");
    expect(nextSchoolStaffEmail(school, "teacher", [user("enseignant001@cslg.com")], [])).toBe("enseignant002@cslg.com");
  });

  it("utilise le sigle pour les parents et conserve le compteur existant", () => {
    const parents = [{ id: "p1", schoolId: school.id, email: "PARENT0001@CSLG.COM" }] as ParentProfile[];
    expect(nextParentEmail(school, [], parents)).toBe("parent0002@cslg.com");
  });

  it("ne change que les futures propositions après modification du sigle et saute les adresses déjà utilisées", () => {
    const existing = [user("enseignant001@cslg.com"), user("enseignant001@lumb.com"), user("enseignant002@lumb.com")];
    const updated = { ...school, acronym: "LUMB" };
    expect(existing[0].email).toBe("enseignant001@cslg.com");
    expect(nextSchoolStaffEmail(updated, "teacher", existing, [])).toBe("enseignant003@lumb.com");
    expect(nextSchoolStaffEmail(updated, "secretary", existing, [])).toBe("secretaire001@lumb.com");
    expect(nextSchoolStaffEmail(updated, "study_director", existing, [])).toBe("etudes001@lumb.com");
    expect(nextParentEmail(updated, [], [])).toBe("parent0001@lumb.com");
  });

  it("conserve explicitement les domaines historiques lorsque le sigle est absent", () => {
    const legacy = { id: "legacy", name: "Complexe Scolaire La Grâce" } as School;
    expect(nextSchoolStaffEmail(legacy, "teacher", [], [])).toBe("enseignant001@complexescolairelagrace.com");
    expect(parentEmailDomain(legacy)).toBe("lagrace.com");
  });

  it("refuse les téléphones vides ou invalides", () => {
    expect(isValidProvisioningPhone("")).toBe(false);
    expect(isValidProvisioningPhone("abc123")).toBe(false);
    expect(isValidProvisioningPhone("0991234567")).toBe(true);
    expect(isValidProvisioningPhone("+243 991 234 567")).toBe(true);
  });
});
