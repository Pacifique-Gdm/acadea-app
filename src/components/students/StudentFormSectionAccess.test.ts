import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { StudentForm } from "./StudentForm";
import { emptyStudent } from "../../utils/studentUtils";
import { readFileSync } from "node:fs";

function render(restricted: boolean) {
  return renderToStaticMarkup(createElement(StudentForm, {
    form: emptyStudent("school-a", "year-a"), setForm: vi.fn(), parents: [],
    quickParent: { fullName: "", phone: "", email: "", password: "" }, setQuickParent: vi.fn(),
    classChoices: [], optionChoices: [], onAddOption: async () => true, onCreateParent: vi.fn(), onSave: vi.fn(), onReset: vi.fn(),
    canCreateParent: !restricted, canManageParentLinks: !restricted, canManageClasses: !restricted, canAddOption: !restricted,
    onAddSubclasses: async () => undefined, onDeleteSubclass: async () => undefined,
  }));
}
describe("formulaire Élèves limité aux opérations permises", () => {
  it("retire réellement du HTML les commandes parents et classes interdites", () => {
    const html = render(true);
    for (const label of ["Rechercher un parent", "Aucun parent lié", "Créer un parent sans quitter la fiche", "Ajouter sous-classe", "Supp. sous-classe", "Mot de passe temporaire"]) {
      expect(html).not.toContain(label);
    }
    expect(html).toContain("Photo de l&#x27;élève");
  });
  it("préserve les commandes de l'administrateur principal", () => {
    const html = render(false);
    expect(html).toContain("Rechercher un parent");
    expect(html).toContain("Ajouter sous-classe");
    expect(html).toContain("Créer un parent sans quitter la fiche");
  });
  it("branche les restrictions dans Élèves et ne propose plus l'annuaire Parent dans le Menu de section", () => {
    const students = readFileSync(new URL("../../modules/students/StudentsModule.tsx", import.meta.url), "utf8");
    const menu = readFileSync(new URL("../../modules/menu/MenuModule.tsx", import.meta.url), "utf8");
    expect(students).toContain("canManageParentLinks={!sectionRole}");
    expect(students).toContain("canManageClasses={!sectionRole}");
    const save = students.slice(students.indexOf("const nextStudents = exists"), students.indexOf("if (pendingParentForStudent)"));
    expect(save).toContain("if (sectionRole)");
    expect(save).toContain("return;");
    expect(menu).toContain('sectionRole && ["years", "school", "history"].includes(section.id)');
  });
});
