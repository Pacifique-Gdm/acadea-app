import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudentForm } from "./StudentForm";
import { emptyStudent } from "../../utils/studentUtils";
import type { SchoolClassRecord } from "../../types";

const cteb: SchoolClassRecord = { id: "cteb", schoolId: "school-a", schoolYearId: "year-a", name: "7ème CTEB", active: true };
const subclass: SchoolClassRecord = { id: "cteb-a", schoolId: "school-a", schoolYearId: "year-a", name: "7ème CTEB - A", parentClassId: cteb.id, subClassLabel: "A", active: true };

function render() {
  return renderToStaticMarkup(createElement(StudentForm, {
    form: { ...emptyStudent("school-a", "year-a"), classId: cteb.id, className: "7ème CTEB" },
    setForm: () => undefined,
    parents: [],
    quickParent: { fullName: "", phone: "", email: "", password: "" },
    setQuickParent: () => undefined,
    classChoices: ["7ème CTEB"],
    optionChoices: [],
    onAddOption: () => undefined,
    onCreateParent: () => undefined,
    onSave: () => undefined,
    onReset: () => undefined,
    structuredClasses: [cteb, subclass],
    onAddSubclasses: async () => undefined,
    onDeleteSubclass: async () => undefined,
  }));
}

describe("formulaire Élève partagé Admin/Secrétaire", () => {
  it("place Classe et Sous-classe juste après Adresse et avant Parent", () => {
    const html = render();
    expect(html.indexOf("Adresse")).toBeLessThan(html.indexOf("Classe"));
    expect(html.indexOf("Classe")).toBeLessThan(html.indexOf("Sous-classe"));
    expect(html.indexOf("Sous-classe")).toBeLessThan(html.indexOf("Parent"));
    expect(html).toContain("Sous-classe <span class=\"text-red-700\">obligatoire</span>");
  });
  it("expose la suppression accessible et les confirmations exactes sans rendre Prénom ni Adresse obligatoires", () => {
    const html = render();
    const source = readFileSync("src/components/students/StudentForm.tsx", "utf8");
    expect(html).toContain('aria-label="Supprimer la sous-classe A"');
    expect(source).toContain('subclassAddConfirmation !== "AJOUTER CETTE SOUS-CLASSE"');
    expect(source).toContain('subclassDeleteConfirmation !== "SUPPRIMER CETTE SOUS-CLASSE"');
    expect(source).toContain('role="dialog"');
    expect(html).not.toMatch(/Prénom[^<]*<[^>]+required/);
    expect(html).not.toMatch(/Adresse[^<]*<[^>]+required/);
  });
});
