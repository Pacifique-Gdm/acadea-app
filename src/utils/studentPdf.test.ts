import { describe, expect, it } from "vitest";
import { formatStudentPdfClassName, formatStudentPdfOptionName, sortStudentsAlphabeticallyForPdf } from "./studentPdf";
import type { SchoolClassRecord, Student } from "../types";

describe("ordre des élèves dans les PDF", () => {
  it("utilise le même ordre nom, postnom, prénom que la pagination UI", () => {
    const students = [
      { id: "3", nom: "Zulu", postnom: "", prenom: "A" },
      { id: "2", nom: "Alpha", postnom: "B", prenom: "A" },
      { id: "1", nom: "Alpha", postnom: "A", prenom: "B" },
    ];
    expect(sortStudentsAlphabeticallyForPdf(students).map((student) => student.id)).toEqual(["1", "2", "3"]);
  });
});

describe("identité opérationnelle dans les PDF élèves", () => {
  const classes: SchoolClassRecord[] = [
    { id: "cteb", schoolId: "school-a", schoolYearId: "year-a", name: "7ème CTEB", active: true },
    { id: "cteb-a", schoolId: "school-a", schoolYearId: "year-a", name: "7ème CTEB - A", parentClassId: "cteb", subClassLabel: "A", active: true },
    { id: "humanity", schoolId: "school-a", schoolYearId: "year-a", name: "1ère Humanité", section: "Secondaire", active: true },
    { id: "literary-a", schoolId: "school-a", schoolYearId: "year-a", name: "1ère Humanité - Littéraire - A", parentClassId: "humanity", classOptionKey: "humanity::litteraire", subClassLabel: "A", active: true },
  ];

  it("affiche CTEB A dans la colonne Classe", () => {
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: "cteb", subClassId: "cteb-a", className: "7ème CTEB" } as Student;
    expect(formatStudentPdfClassName(student, classes)).toBe("7ème CTEB A");
  });

  it("affiche Littéraire A une seule fois dans la colonne Option", () => {
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: "humanity", subClassId: "literary-a", classOptionKey: "humanity::litteraire", className: "1ère Humanité", option: "Littéraire" } as Student;
    expect(formatStudentPdfClassName(student, classes)).toBe("1ère Humanité");
    expect(formatStudentPdfOptionName(student, classes)).toBe("Littéraire A");
  });
  it("revient au parent et à l'option après désactivation d'une sous-classe sans référence fantôme", () => {
    const inactive = classes.map((item) => item.id === "literary-a" ? { ...item, active: false } : item);
    const student = { schoolId: "school-a", schoolYearId: "year-a", classId: "humanity", className: "1ère Humanité", option: "Littéraire" } as Student;
    expect(formatStudentPdfClassName(student, inactive)).toBe("1ère Humanité");
    expect(formatStudentPdfOptionName(student, inactive)).toBe("Littéraire");
  });
});
