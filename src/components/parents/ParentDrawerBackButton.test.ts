import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Retour des formulaires Parent", () => {
  const editorSource = readFileSync(new URL("./ParentFormEditor.tsx", import.meta.url), "utf8");
  const adminSource = readFileSync(new URL("../../modules/menu/MenuModule.tsx", import.meta.url), "utf8");
  const secretarySource = readFileSync(new URL("../../modules/secretary/SecretaryMenuModule.tsx", import.meta.url), "utf8");

  it("réutilise le même bouton pour créer et supprimer un parent", () => {
    expect(editorSource).toContain("export function ParentDrawerBackButton");
    expect(editorSource).toContain("<ParentDrawerBackButton onBack={onBack} />");
    expect(adminSource).toContain("<ParentDrawerBackButton onBack={closeParentDeleteDrawer} />");
    expect(secretarySource).toContain("<ParentDrawerBackButton onBack=");
    expect(editorSource).toContain('aria-label="Retour aux Parents / Tuteurs"');
  });
});
