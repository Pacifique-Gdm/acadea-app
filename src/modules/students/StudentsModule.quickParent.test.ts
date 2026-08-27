import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StudentsModule.tsx", import.meta.url), "utf8");

describe("création rapide différée d'un Parent", () => {
  it("persiste l'élève avant de provisionner le Parent avec son véritable ID", () => {
    const persistence = source.indexOf("await persistFirestorePatch(");
    const provisionAfterPersistence = source.indexOf("const provisioned = await provisionParent(", persistence);
    expect(persistence).toBeGreaterThan(-1);
    expect(provisionAfterPersistence).toBeGreaterThan(persistence);
    expect(source).toContain('id: exists ? form.id : uid("student")');
    expect(source).toContain("studentIds: [student.id]");
    expect(source).not.toContain("studentIds: [form.id]");
  });

  it("garde un état récupérable si le provisionnement Parent échoue", () => {
    expect(source).toContain("setPendingQuickParent(pendingParent)");
    expect(source).toContain("pendingQuickParent?.parentId === selectedParentId");
    expect(source).not.toContain("!exists && pendingQuickParent?.parentId === selectedParentId");
    expect(source).toContain("L’élève a été enregistré, mais le compte Parent n’a pas pu être créé");
    expect(source).toContain("setForm(student)");
    expect(source).toContain("provisioned.parent.id");
    expect(source).toContain("provisioned.parent");
    expect(source).toContain("provisioned.user");
  });

  it("affiche un succès local temporaire et réinitialise le mini-formulaire sans mentir sur la création différée", () => {
    expect(source).toContain('setQuickParentFeedback("Parent créé et sélectionné avec succès.")');
    expect(source).toContain('setQuickParentFeedback("Parent prêt et sélectionné. Il sera créé lors de l’enregistrement de l’élève.")');
    expect(source).toContain('window.setTimeout(() => setQuickParentFeedback(""), 4000)');
    expect(source).toContain("return () => window.clearTimeout(timer)");
    expect(source).not.toContain("Parent prêt à être créé après l’enregistrement de l’élève.");
  });
});
