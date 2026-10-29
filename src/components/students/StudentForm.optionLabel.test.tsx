import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyStudent } from "../../utils/studentUtils";
import { StudentForm } from "./StudentForm";

describe("formulaire d'ajout d'élève partagé", () => {
  it("affiche le nouveau libellé tout en conservant l'ancienne valeur de référence", () => {
    const html = renderToStaticMarkup(createElement(StudentForm, {
      form: { ...emptyStudent("school-a", "year-a"), className: "1ère Humanité", option: "Sciences" },
      setForm: vi.fn(), parents: [], quickParent: { fullName: "", phone: "", email: "", password: "" }, setQuickParent: vi.fn(),
      classChoices: ["1ère Humanité"], optionChoices: ["Sciences"], optionLabels: { Sciences: "Technologies" },
      onAddOption: async () => true, onCreateParent: vi.fn(), onSave: vi.fn(), onReset: vi.fn(), canAddOption: false,
    }));
    expect(html).toContain('value="Sciences"');
    expect(html).toContain("Technologies");
  });
});
