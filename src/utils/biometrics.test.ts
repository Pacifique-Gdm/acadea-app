import { describe, expect, it } from "vitest";
import type { Student } from "../types";
import { hasAssignedCard, hasEnrolledFingerprint, maskCardUid, resolveStudentBiometric } from "./biometrics";
import { defaultStudentBiometric, emptyStudent } from "./studentUtils";

describe("données biométriques élève", () => {
  it("ajoute la structure par défaut aux nouveaux élèves", () => {
    expect(emptyStudent("school-a", "year-a").biometric).toEqual(defaultStudentBiometric);
  });

  it("lit sans erreur un ancien document dépourvu du champ biometric", () => {
    expect(resolveStudentBiometric({} as Student)).toEqual(defaultStudentBiometric);
  });

  it("sélectionne uniquement les empreintes enregistrées", () => {
    expect(hasEnrolledFingerprint({ biometric: { ...defaultStudentBiometric, fingerprintStatus: "enrolled" } } as Student)).toBe(true);
    expect(hasEnrolledFingerprint({} as Student)).toBe(false);
  });

  it("reconnaît une carte par son statut ou son UID", () => {
    expect(hasAssignedCard({ biometric: { ...defaultStudentBiometric, cardStatus: "assigned" } } as Student)).toBe(true);
    expect(hasAssignedCard({ biometric: { ...defaultStudentBiometric, cardUid: "12345678" } } as Student)).toBe(true);
    expect(hasAssignedCard({} as Student)).toBe(false);
  });

  it("masque l'UID uniquement pour l'affichage", () => {
    expect(maskCardUid("1234567890")).toBe("12••••••90");
    expect(maskCardUid(null)).toBe("—");
  });
});
