import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formToTemplateInput, percentToBasisPoints, templateFormProblems, templateToForm, type AllocationTemplate } from "./coordinationAllocationTemplate";

// Lot 7 — écran « Modèles de répartition » du Coordinateur.
const template: AllocationTemplate = {
  coordinationId: "c", name: "Modèle", version: 3, publishedAt: "2026-11-27T10:00:00.000Z",
  rubrics: [{ id: "personnel01", name: "Personnel", subRubrics: [{ id: "enseignant1", name: "Enseignant", basisPoints: 1250 }] }, { id: "fonction001", name: "Fonctionnement", subRubrics: [] }],
  feeTypes: [{ id: "minerval01", label: "Minerval", allocations: [{ rubricId: "personnel01", basisPoints: 4000 }] }],
  defaultAllocations: [{ rubricId: "fonction001", basisPoints: 6000 }],
};

describe("lot 7 — formulaire du modèle", () => {
  it("convertit les pourcentages saisis (virgule ou point, deux décimales au plus)", () => {
    expect(percentToBasisPoints("40")).toBe(4000);
    expect(percentToBasisPoints("12,5")).toBe(1250);
    expect(percentToBasisPoints(" 0.25 ")).toBe(25);
    expect(percentToBasisPoints("")).toBe(0);
    expect(percentToBasisPoints("abc")).toBeNaN();
    expect(percentToBasisPoints("1,234")).toBeNaN();
  });
  it("modèle publié → formulaire → envoi : mêmes valeurs (aller-retour sans perte)", () => {
    const form = templateToForm(template);
    expect(form.rubrics[0].subRubrics[0].percent).toBe("12,5");
    const { name, rubrics, feeTypes, defaultAllocations } = template;
    expect(formToTemplateInput(form)).toEqual({ name, rubrics, feeTypes, defaultAllocations });
    expect(templateFormProblems(form)).toEqual([]);
  });
  it("signale ce qui bloque la publication : nom vide, total au-delà de 100 %, pourcentage invalide", () => {
    const form = templateToForm(template);
    form.name = " ";
    form.feeTypes[0].percents.fonction001 = "70";
    form.defaultPercents.personnel01 = "x";
    expect(templateFormProblems(form)).toEqual(["Donnez un nom au modèle.", "« Minerval » dépasse 100 %.", "Pourcentage invalide dans « Tout autre frais »."]);
  });
  it("le menu n'affiche « Modèles de répartition » qu'au Coordinateur principal, et l'écran ne lit aucune donnée d'école", () => {
    const menu = readFileSync("src/modules/coordination/CoordinationMenu.tsx", "utf8");
    expect(menu).toContain('...(user.role === "coordination_admin" ? [["templates", "Modèles de répartition", Layers] as const] : [])');
    expect(menu).toContain('if (drawer === "templates") return user.role === "coordination_admin" ? <AllocationTemplateEditor /> : null;');
    const editor = readFileSync("src/modules/coordination/AllocationTemplateEditor.tsx", "utf8");
    expect(editor).not.toMatch(/firebase\/firestore|students|payments|schoolId/);
  });
});
