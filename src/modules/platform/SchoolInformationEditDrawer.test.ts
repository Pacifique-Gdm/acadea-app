import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { School } from "../../types";
import {
  SCHOOL_INFORMATION_CONFIRMATION,
  canSaveSchoolInformation,
  schoolInformationDraft,
  schoolInformationPatch,
} from "./schoolInformation";

const school: School = {
  id: "school-a",
  name: "Acadéa Démonstration",
  address: "Kinshasa",
  phone: "+243000000000",
  email: "contact@example.test",
  motto: "Toujours plus haut",
  logoUrl: "https://example.test/logo.png",
  schoolType: "Secondaire uniquement",
  educationLevels: ["Secondaire"],
  currency: "CDF",
  status: "active",
  activeSchoolYearId: "year-active",
  subscriptionPlan: "Standard",
  subscriptionAmount: 0,
};

describe("SchoolInformationEditDrawer", () => {
  it("préremplit et construit le patch depuis la source école unique", () => {
    const draft = schoolInformationDraft(school);
    expect(draft).toMatchObject({
      name: school.name,
      motto: school.motto,
      logoUrl: school.logoUrl,
      level: "Secondaire uniquement",
    });

    const patch = schoolInformationPatch({ ...draft, name: "  Nouveau nom  ", motto: "  Nouvelle devise  " });
    expect(patch).toMatchObject({
      name: "Nouveau nom",
      motto: "Nouvelle devise",
      logoUrl: school.logoUrl,
      schoolType: "Secondaire uniquement",
      educationLevels: ["Secondaire"],
    });
    expect(patch).not.toHaveProperty("currency");
  });

  it.each(["", "modifier informations école", "MODIFIER INFORMATIONS ECOLE", "MODIFIER INFORMATIONS ÉCOLE ", " MODIFIER INFORMATIONS ÉCOLE"]) (
    "désactive la sauvegarde pour la confirmation non exacte %s",
    (confirmation) => {
      expect(canSaveSchoolInformation({
        draft: schoolInformationDraft(school),
        confirmation,
        saving: false,
        logoProcessing: false,
      })).toBe(false);
    },
  );

  it("autorise une seule sauvegarde lorsque les conditions sont réunies", () => {
    const draft = schoolInformationDraft(school);
    expect(canSaveSchoolInformation({ draft, confirmation: SCHOOL_INFORMATION_CONFIRMATION, saving: false, logoProcessing: false })).toBe(true);
    expect(canSaveSchoolInformation({ draft, confirmation: SCHOOL_INFORMATION_CONFIRMATION, saving: true, logoProcessing: false })).toBe(false);
    expect(canSaveSchoolInformation({ draft, confirmation: SCHOOL_INFORMATION_CONFIRMATION, saving: false, logoProcessing: true })).toBe(false);
  });

  it("conserve un Drawer responsive, le logo, tous les champs et un footer 50/50", () => {
    const source = readFileSync(new URL("./SchoolInformationEditDrawer.tsx", import.meta.url), "utf8");
    expect(source).toContain("<AdminDrawer");
    expect(source).toContain("<ImageUploadField");
    for (const label of ["Nom de l'école", "Devise", "Adresse", "Téléphone", "Email", "Niveau de l'école"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("grid-cols-2");
    expect(source).toContain("min-w-0");
    expect(source).toContain("w-full");
  });
});
