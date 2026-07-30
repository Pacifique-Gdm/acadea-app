import { describe, expect, it } from "vitest";
import type { Student } from "../types";
import { getClassSection, getStudentSection, promoteStudentForNewYear } from "./studentClasses";
import { getSchoolClassChoices } from "./schoolConfig";

function student(className: Student["className"], option?: string) {
  return { id: "student", className, option } as Student;
}

describe("promotions", () => {
  it("classe toujours 7ème et 8ème CTEB dans la section CTEB", () => {
    expect(getClassSection("7ème CTEB")).toBe("cteb");
    expect(getClassSection("8ème CTEB")).toBe("cteb");
  });

  it("corrige à la lecture une ancienne section primaire contradictoire", () => {
    expect(getStudentSection({ className: "7ème CTEB", section: "primaire" })).toBe("cteb");
    expect(getStudentSection({ className: "8ème CTEB", section: "primaire" })).toBe("cteb");
  });

  it("propose 7ème et 8ème uniquement dans les classes CTEB", () => {
    const ctebClasses = getSchoolClassChoices({ educationLevels: ["CTEB"], schoolType: "CTEB uniquement" });
    const primaryClasses = getSchoolClassChoices({ educationLevels: ["Primaire"], schoolType: "Primaire uniquement" });
    expect(ctebClasses).toEqual(["7ème CTEB", "8ème CTEB"]);
    expect(primaryClasses).not.toContain("7ème CTEB");
    expect(primaryClasses).not.toContain("8ème CTEB");
  });

  it("promeut une classe ordinaire", () => {
    expect(promoteStudentForNewYear(student("1ère Primaire"))).toMatchObject({ className: "2ème Primaire", promoted: true });
  });

  it("signale les transitions de section", () => {
    expect(promoteStudentForNewYear(student("6ème Primaire"))).toMatchObject({ className: "7ème CTEB", transition: "primaire-cteb" });
  });

  it("retire l'option à l'entrée en Humanités pour imposer un nouveau choix", () => {
    expect(promoteStudentForNewYear(student("8ème CTEB", "Sciences"))).toMatchObject({
      className: "1ère Humanité",
      option: undefined,
      optionPending: true,
    });
  });

  it("ne dépasse pas la dernière classe", () => {
    expect(promoteStudentForNewYear(student("4ème Humanité", "Sciences"))).toMatchObject({ className: "4ème Humanité", promoted: false });
  });
});
