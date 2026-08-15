import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateDropdownPosition } from "./dropdownPosition";

const source = readFileSync(new URL("./MultiSelectDropdown.tsx", import.meta.url), "utf8");

describe("MultiSelectDropdown partagé", () => {
  it("ouvre sous le champ lorsqu'il reste assez de place", () => {
    expect(calculateDropdownPosition({ left: 40, top: 100, bottom: 144, width: 280 }, 1280, 800)).toMatchObject({ left: 40, top: 148, width: 280, placement: "below" });
  });

  it("ouvre au-dessus du champ proche du bas et reste dans le viewport", () => {
    const position = calculateDropdownPosition({ left: 900, top: 690, bottom: 734, width: 420 }, 1024, 768);
    expect(position.top).toBeGreaterThanOrEqual(8);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(690);
    expect(position.left + position.width).toBeLessThanOrEqual(1016);
    expect(position).toMatchObject({ placement: "above", bottom: 82 });
  });

  it("reste utilisable sur un petit viewport", () => {
    const position = calculateDropdownPosition({ left: 4, top: 180, bottom: 224, width: 500 }, 320, 480);
    expect(position.left).toBe(8);
    expect(position.width).toBe(304);
    expect(position.maxHeight).toBeGreaterThanOrEqual(72);
  });

  it("utilise un portail, ferme au click-outside et avec Escape sans modifier les valeurs", () => {
    expect(source).toContain("createPortal(menu, document.body)");
    expect(source).toContain('document.addEventListener("pointerdown", closeOutside)');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("event.stopImmediatePropagation()");
    expect(source).toContain('window.addEventListener("keydown", closeOnEscape, true)');
    expect(source).toContain("window.addEventListener(OPEN_EVENT, closeForSibling)");
    expect(source).toContain('className="fixed z-[60] overflow-x-hidden overflow-y-auto');
    expect(source).not.toContain("onChange([])");
  });
});
