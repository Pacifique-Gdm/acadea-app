import { describe, expect, it } from "vitest";
import type { SchoolClass, Student } from "../types";
import { getClassSection, getStudentSection, promoteStudentForNewYear } from "./studentClasses";
import { getSchoolClassChoices } from "./schoolConfig";

function student(className: Student["className"], option?: string) {
  return { id: "student", className, option } as Student;
}

describe("promotions", () => {
  it("classe les anciennes classes optionnelles Scientifique/Sciences dans le Secondaire", () => {
    expect(getClassSection("1ère Scientifique" as SchoolClass)).toBe("Secondaire");
    expect(getClassSection("2ème Sciences" as SchoolClass)).toBe("Secondaire");
  });

  it("classe les options des Humanités écrites dans le nom de la classe dans le Secondaire", () => {
    for (const name of ["4ème Commerciale", "2ème Commerciale et Gestion", "3ème Pédagogie Générale", "1ère Littéraire", "2ème Latin-Philo", "4ème Technique Mécanique", "3ème Électricité", "1ère Nutrition", "2ème Math-Physique"]) {
      expect(getClassSection(name as SchoolClass)).toBe("Secondaire");
    }
    for (const name of ["1ère Primaire", "6ème Primaire", "Maternelle 2"]) expect(getClassSection(name as SchoolClass)).not.toBe("Secondaire");
  });

  it("classe toujours 7ème et 8ème CTEB dans la section CTEB", () => {
    expect(getClassSection("7ème CTEB")).toBe("CTEB");
    expect(getClassSection("8ème CTEB")).toBe("CTEB");
  });

  it("corrige à la lecture une ancienne section primaire contradictoire", () => {
    expect(getStudentSection({ className: "7ème CTEB", section: "Primaire" })).toBe("CTEB");
    expect(getStudentSection({ className: "8ème CTEB", section: "Primaire" })).toBe("CTEB");
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
