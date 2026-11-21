import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { waitForCondition } from "./waitForCondition";

const drawer = readFileSync(new URL("../components/students/StudentRecordDrawer.tsx", import.meta.url), "utf8");

describe("fiche élève : « Sauver » pendant le chargement des classes", () => {
  it("attend que la condition devienne vraie", async () => {
    let ready = false;
    setTimeout(() => { ready = true; }, 30);
    await expect(waitForCondition(() => ready, 1000, 5)).resolves.toBe(true);
  });
  it("abandonne après le délai", async () => {
    await expect(waitForCondition(() => false, 30, 5)).resolves.toBe(false);
  });
  it("la fiche attend la fin du chargement au lieu de refuser l'enregistrement", () => {
    expect(drawer).toContain("if (!(await waitForCondition(() => classesRef.current.loaded)))");
    expect(drawer).not.toContain("Chargement des classes en cours. Veuillez réessayer.");
  });
});
