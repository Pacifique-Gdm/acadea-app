import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MultiSelectDropdown.tsx", import.meta.url), "utf8");

describe("MultiSelectDropdown partagé", () => {
  it("ferme au click-outside tactile/souris et avec Escape sans modifier les valeurs", () => {
    expect(source).toContain('useDismissibleDropdown(() => setOpen(false))');
    expect(source).not.toContain("onChange([])");
  });
});
