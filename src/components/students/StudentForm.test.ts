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
  it("place Classe, Sous-classe et Photo juste après Adresse et avant Parent", () => {
    const html = render();
    expect(html.indexOf("Adresse")).toBeLessThan(html.indexOf("Classe"));
    expect(html.indexOf("Classe")).toBeLessThan(html.indexOf("Sous-classe"));
    expect(html.indexOf("Sous-classe")).toBeLessThan(html.indexOf("Photo de l&#x27;élève"));
    expect(html.indexOf("Photo de l&#x27;élève")).toBeLessThan(html.indexOf("Parent"));
    expect(html).not.toContain("Sous-classe <span class=\"text-red-700\">obligatoire</span>");
    expect(html).toMatch(/Sous-classe[^]*?<select[^>]*required/);
  });
  it("affiche les deux actions contextuelles sans croix permanente", () => {
    const html = render();
    const source = readFileSync("src/components/students/StudentForm.tsx", "utf8");
    expect(html).toContain("Ajouter sous-classe");
    expect(html).toContain("Supprimer sous-classe");
    expect(html).not.toContain('aria-label="Supprimer la sous-classe A"');
    expect(source).toContain("AJOUTER CETTE SOUS-CLASSE");
    expect(source).toContain("SUPPRIMER CETTE SOUS-CLASSE");
    expect(source).toContain('subclassAddConfirmation !== "AJOUTER CETTE SOUS-CLASSE"');
    expect(source).toContain('subclassDeleteConfirmation !== "SUPPRIMER CETTE SOUS-CLASSE"');
    expect(source).toContain('role="dialog"');
    expect(html).not.toMatch(/Prénom[^<]*<[^>]+required/);
    expect(html).not.toMatch(/Adresse[^<]*<[^>]+required/);
  });
  it("garde deux boutons de gestion sur une ligne et les formulaires sous ces boutons", () => {
    const html = render();
    const source = readFileSync("src/components/students/StudentForm.tsx", "utf8");
    expect(html).toMatch(/grid-cols-2[^]*?Ajouter sous-classe[^]*?Supprimer sous-classe/);
    expect(source.indexOf('subclassMode === "add" &&')).toBeGreaterThan(source.indexOf("Supprimer sous-classe"));
    expect(source.indexOf('subclassMode === "delete" &&')).toBeGreaterThan(source.indexOf('subclassMode === "add" &&'));
    expect(source).toContain('className="grid min-w-0 grid-cols-2 gap-2"');
    expect(source).not.toContain("Les élèves seront conservés dans la classe parent et leur option, sans cette sous-classe.");
  });
  it("empêche la saisie libre et ferme les états contextuels au clic extérieur", () => {
    const source = readFileSync("src/components/students/StudentForm.tsx", "utf8");
    expect(source).toContain('value={label} readOnly');
    expect(source).toContain('nextSubclassLetters(existingSubclassLabels');
    expect(source).toContain('document.addEventListener("pointerdown", onOutsidePointerDown)');
    expect(source).toContain('document.removeEventListener("pointerdown", onOutsidePointerDown)');
    expect(source).toContain('setSubclassDeleteConfirmation("")');
    expect(source).toContain('setSubclassAddConfirmation("")');
  });
});
