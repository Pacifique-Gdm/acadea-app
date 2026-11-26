import { describe, expect, it } from "vitest";
import * as server from "./sectionAuthority.js";
import { resolveSectionAuthority as screenAuthority, canManageSections as screenCanManage } from "../../src/utils/sectionAuthority";
import { getSchoolSections as screenSchoolSections } from "../../src/utils/schoolConfig";

const levelChoices = [[], ["Maternelle"], ["Primaire"], ["CTEB"], ["Secondaire"], ["primaire", "cetb"], ["Mixte"], ["Primaire uniquement"],
  ["CTEB et Secondaire"], ["Secondaire uniquement", "Maternelle"], ["Maternelle", "Primaire", "CTEB", "Secondaire"], ["inconnu"]];
const typeChoices = [undefined, "", "Mixte", "CTEB", "Secondaire", "Primaire", "Primaire uniquement", "CTEB uniquement", "Secondaire uniquement", "CTEB et Secondaire", "Maternelle"];
const users = [{}, { section: "Primaire" }, { section: "primaire" }, { sectionIds: ["CTEB", "Secondaire"] }, { sectionIds: [], section: "Secondaire" },
  { sectionIds: ["Maternelle", "Primaire", "CTEB", "Secondaire"] }, { sectionIds: ["inconnu"] }, { section: null }];

describe("périmètre de réglage par section côté serveur", () => {
  it("donne exactement le même résultat que l'écran pour toutes les combinaisons", () => {
    for (const educationLevels of levelChoices) for (const schoolType of typeChoices) {
      const school = { educationLevels, schoolType } as never;
      expect(server.getSchoolSections(school)).toEqual(screenSchoolSections(school));
      for (const user of users) {
        const a = server.resolveSectionAuthority(user, school);
        const b = screenAuthority(user as never, school);
        expect(a).toEqual(b);
        for (const sections of [[], ["Primaire"], ["Secondaire"], ["CTEB", "Secondaire"]]) {
          expect(server.canManageSections(a, sections)).toBe(screenCanManage(b, sections as never));
        }
      }
    }
  });

  it("supporte une école ou un compte absent sans planter", () => {
    expect(server.getSchoolSections(undefined)).toEqual(["Maternelle", "Primaire", "CTEB", "Secondaire"]);
    expect(server.resolveSectionAuthority(undefined, undefined).wholeSchool).toBe(true);
    expect(server.canManageSections({ wholeSchool: false, sections: ["Primaire"], schoolSections: [] }, undefined)).toBe(false);
  });
});
