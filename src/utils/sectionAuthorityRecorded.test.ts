import { describe, expect, it } from "vitest";
import type { AppUser, School } from "../types";
import { mergeRealtimeUserProfile } from "../services/auth";
import { canManageSections, resolveSectionAuthority } from "./sectionAuthority";

// Calendrier : l'écran lit les sections du compte comme la règle Firestore (sections telles qu'écrites).
const complete = { educationLevels: ["Maternelle", "Primaire", "CTEB", "Secondaire"] } as Pick<School, "educationLevels" | "schoolType">;
const primaryOnly = { educationLevels: [], schoolType: "Primaire uniquement" } as Pick<School, "educationLevels" | "schoolType">;
const connected: AppUser = { id: "d", name: "Direction", email: "d@example.test", role: "study_director", schoolId: "s" };
const options = { recordedSections: true };

describe("calendrier : sections invalides = compte limité", () => {
  it("un compte aux sections invalides reste limité, jamais « toute l'école »", () => {
    for (const profile of [{ sectionIds: ["Lycée"] }, { section: "Lycée" }, { sectionIds: [], section: "Lycée" }]) {
      const user = mergeRealtimeUserProfile(connected, profile);
      // Fonctionnement des autres écrans : inchangé.
      expect(resolveSectionAuthority(user, complete).wholeSchool).toBe(true);
      const authority = resolveSectionAuthority(user, complete, options);
      expect(authority).toMatchObject({ wholeSchool: false, sections: [] });
      expect(canManageSections(authority, [])).toBe(false);
      expect(canManageSections(authority, ["Primaire"])).toBe(false);
    }
  });

  it("une section mal écrite n'est pas reconnue, comme dans la règle", () => {
    const user = mergeRealtimeUserProfile(connected, { sectionIds: ["primaire"] });
    expect(resolveSectionAuthority(user, primaryOnly, options)).toMatchObject({ wholeSchool: false, sections: [] });
  });

  it("une section invalide à côté de sections valides ne change rien", () => {
    const user = mergeRealtimeUserProfile(connected, { sectionIds: ["Lycée", "Primaire"] });
    expect(resolveSectionAuthority(user, complete, options)).toMatchObject({ wholeSchool: false, sections: ["Primaire"] });
    const covering = mergeRealtimeUserProfile(connected, { sectionIds: ["Lycée", "Maternelle", "Primaire", "CTEB", "Secondaire"] });
    expect(resolveSectionAuthority(covering, complete, options).wholeSchool).toBe(true);
  });

  it("compte sans section et comptes aux sections valides : résultat identique à avant", () => {
    for (const profile of [{}, { sectionIds: [] }, { sectionIds: ["Primaire"] }, { section: "Secondaire" }, { sectionIds: ["Maternelle", "Primaire", "CTEB", "Secondaire"] }]) {
      const user = mergeRealtimeUserProfile(connected, profile);
      expect(resolveSectionAuthority(user, complete, options)).toEqual(resolveSectionAuthority(user, complete));
    }
  });

  it("sans sections enregistrées connues (compte construit ailleurs), résultat identique à avant", () => {
    const user = { sectionIds: ["Primaire" as const] };
    expect(resolveSectionAuthority(user, complete, options)).toEqual(resolveSectionAuthority(user, complete));
  });

  it("le responsable désigné reste pris en compte avec cette lecture", () => {
    const user = { ...mergeRealtimeUserProfile(connected, { sectionIds: ["CTEB", "Secondaire"] }), id: "directeur" };
    const authority = resolveSectionAuthority(user, complete, { ...options, sectionSettingsManagers: { Secondaire: "prefet" } });
    expect(authority.sections).toEqual(["CTEB"]);
    expect(canManageSections(authority, ["Secondaire"])).toBe(false);
  });
});
