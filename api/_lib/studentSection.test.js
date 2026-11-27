import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { InvalidStudentSection, requiredStudentSection } from "./studentSection.js";

// Section obligatoire pour tout élève (décision du 27/11/2026).
describe("section obligatoire d'un élève", () => {
  it("calcule la section d'après la classe quand elle manque", () => {
    expect(requiredStudentSection({ className: "1ère Maternelle" })).toBe("Maternelle");
    expect(requiredStudentSection({ className: "3ème Primaire", section: "" })).toBe("Primaire");
    expect(requiredStudentSection({ className: "7ème CTEB", section: null })).toBe("CTEB");
    expect(requiredStudentSection({ className: "4ème Humanité" })).toBe("Secondaire");
    expect(requiredStudentSection({ className: "4ème Commerciale" })).toBe("Secondaire");
  });

  it("garde une section valide envoyée (écriture normalisée)", () => {
    expect(requiredStudentSection({ className: "3ème Primaire", section: "Primaire" })).toBe("Primaire");
    expect(requiredStudentSection({ className: "4ème Humanité", section: "secondaire" })).toBe("Secondaire");
  });

  it("une classe CTEB reste en section CTEB (même compatibilité que l'écran)", () => {
    expect(requiredStudentSection({ className: "8ème CTEB", section: "Primaire" })).toBe("CTEB");
  });

  it("refuse une section inconnue", () => {
    expect(() => requiredStudentSection({ className: "3ème Primaire", section: "Lycée" })).toThrow(InvalidStudentSection);
    expect(() => requiredStudentSection({ className: "3ème Primaire", section: 4 })).toThrow("Section de l’élève invalide.");
  });

  it("est appliquée à la création, à la modification et au changement de classe", () => {
    expect(readFileSync(new URL("./manualStudentSave.js", import.meta.url), "utf8")).toContain("next.section = requiredStudentSection(next);");
    expect(readFileSync(new URL("./studentClassChange.js", import.meta.url), "utf8")).toContain("next.section = requiredStudentSection(next);");
  });
});
