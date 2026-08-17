import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { disciplineStudentQuerySections, schoolMessageLegacyRecipients } from "./firestoreData";

describe("query students du Directeur de Discipline", () => {
  it("borne le bootstrap aux sections attribuées", () => {
    expect(
      disciplineStudentQuerySections({ role: "discipline_director", sectionIds: ["Primaire", "CTEB"] }),
    ).toEqual(["Primaire", "CTEB"]);
  });

  it("reconnaît la section historique unique", () => {
    expect(
      disciplineStudentQuerySections({ role: "discipline_director", section: "Secondaire", sectionIds: [] }),
    ).toEqual(["Secondaire"]);
  });

  it("n'exécute aucune query students sans périmètre attribué", () => {
    expect(
      disciplineStudentQuerySections({ role: "discipline_director", sectionIds: [] }),
    ).toBeNull();
  });

  it("ne modifie pas le comportement des autres rôles", () => {
    expect(disciplineStudentQuerySections({ role: "school_admin", sectionIds: [] })).toBeNull();
  });
});

describe("queries messages autorisées par rôle", () => {
  it("n'envoie pas de query legacy interdite au Directeur des études", () => {
    expect(schoolMessageLegacyRecipients("study_director")).toBeNull();
  });

  it("conserve les destinataires legacy propres à chaque portail", () => {
    expect(schoolMessageLegacyRecipients("school_admin")).toEqual(["admin", "both"]);
    expect(schoolMessageLegacyRecipients("cashier")).toEqual(["cashier", "both"]);
    expect(schoolMessageLegacyRecipients("discipline_director")).toEqual(["discipline"]);
    expect(schoolMessageLegacyRecipients("secretary")).toBeNull();
  });
});

describe("actualisation du portail Direction des études", () => {
  it("ne lance pas les queries génériques interdites", () => {
    const source = readFileSync(new URL("./firestoreData.ts", import.meta.url), "utf8");
    expect(source).toContain('if (user.role === "study_director") return {};');
  });
});
