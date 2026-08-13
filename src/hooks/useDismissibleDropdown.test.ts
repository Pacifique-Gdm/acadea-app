import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/hooks/useDismissibleDropdown.ts", "utf8");

describe("dropdown fermable partagé", () => {
  it("gère clic extérieur, Escape et nettoyage des listeners", () => {
    expect(source).toContain('document.addEventListener("pointerdown", closeOutside)');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('document.removeEventListener("pointerdown", closeOutside)');
  });
});
