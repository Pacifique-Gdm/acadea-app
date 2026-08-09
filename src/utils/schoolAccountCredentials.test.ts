import { describe, expect, it } from "vitest";
import type { AppUser, ParentProfile, School } from "../types";
import { isValidProvisioningPhone, nextSchoolStaffEmail, normalizeSchoolEmailDomain, schoolStaffEmailPrefixes } from "./schoolAccountCredentials";

const school = { id: "school-1", name: "Complexe Scolaire La Grâce" } as School;
const user = (email: string) => ({ id: email, schoolId: school.id, email } as AppUser);

describe("identifiants temporaires des comptes métier", () => {
  it.each([
    ["cashier", "caissier001@complexescolairelagrace.com"],
    ["secretary", "secretaire001@complexescolairelagrace.com"],
    ["discipline_director", "discipline001@complexescolairelagrace.com"],
    ["study_director", "etudes001@complexescolairelagrace.com"],
  ] as const)("génère l'adresse attendue pour %s", (role, expected) => {
    expect(nextSchoolStaffEmail(school, role, [], [])).toBe(expected);
  });

  it("normalise accents, espaces, apostrophes et caractères spéciaux", () => {
    expect(normalizeSchoolEmailDomain("École Sainte-Marie d’Espérance !")).toBe("ecolesaintemariedesperance.com");
  });

  it("passe à 002 sans doublon, y compris avec un parent existant", () => {
    const parents = [{ email: "CAISSIER001@complexescolairelagrace.com" }] as ParentProfile[];
    expect(nextSchoolStaffEmail(school, "cashier", [], parents)).toBe("caissier002@complexescolairelagrace.com");
  });

  it("change de préfixe selon le rôle", () => {
    expect(schoolStaffEmailPrefixes).toEqual({ cashier: "caissier", secretary: "secretaire", discipline_director: "discipline", study_director: "etudes" });
    expect(nextSchoolStaffEmail(school, "secretary", [user("caissier001@complexescolairelagrace.com")], [])).toBe("secretaire001@complexescolairelagrace.com");
  });

  it("refuse les téléphones vides ou invalides", () => {
    expect(isValidProvisioningPhone("")).toBe(false);
    expect(isValidProvisioningPhone("abc123")).toBe(false);
    expect(isValidProvisioningPhone("0991234567")).toBe(true);
    expect(isValidProvisioningPhone("+243 991 234 567")).toBe(true);
  });
});
