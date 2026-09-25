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
    expect(html).toMatch(/<button[^>]*>Ajouter sous-classe<\/button>/);
    expect(html).toContain("Supp. sous-classe");
    expect(html).not.toContain(">Supprimer sous-classe<");
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
    expect(html).toMatch(/grid-cols-2[^]*?Ajouter sous-classe[^]*?Supp\. sous-classe/);
    expect(source.indexOf('subclassMode === "add" &&')).toBeGreaterThan(source.indexOf("Supp. sous-classe"));
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
  it("signale temporairement une classe sans sous-classe au-dessus des actions", () => {
    const source = readFileSync("src/components/students/StudentForm.tsx", "utf8");
    expect(source).toContain("Cette classe n'a pas de sous-classe");
    expect(source.indexOf("Cette classe n'a pas de sous-classe")).toBeLessThan(source.indexOf("Supp. sous-classe"));
    expect(source).toContain('className="text-sm font-medium text-red-700"');
    expect(source).toContain('if (subclasses.length === 0)');
    expect(source).toContain('setShowEmptySubclassMessage(true)');
    expect(source).toContain('window.setTimeout(() => setShowEmptySubclassMessage(false), 4000)');
    expect(source).toContain('window.clearTimeout(timer)');
    expect(source).not.toContain('disabled={!onDeleteSubclass || subclasses.length === 0');
  });
  it("utilise une saisie texte jj/mm/aaaa sans calendrier natif", () => {
    const html = render();
    const source = readFileSync("src/components/students/StudentForm.tsx", "utf8");
    expect(html).toContain('placeholder="jj/mm/aaaa"');
    expect(html).toContain('pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"');
    expect(source).not.toContain('type="date"');
    expect(source).toContain("parseStudentBirthDateInput");
  });
});
