import { describe, expect, it } from "vitest";
import type { Student } from "../types";
import { promoteStudentForNewYear } from "./studentClasses";

function student(className: Student["className"], option?: string) {
  return { id: "student", className, option } as Student;
}

describe("promotions", () => {
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
