import { describe, expect, it } from "vitest";
import { classFilterReadyForPage } from "./classFilterReadiness";

describe("chargement progressif des choix Coordination", () => {
  it("n'attend pas les classes pour une première page sans filtre classe/option", () => {
    expect(classFilterReadyForPage("", "", false, false, false)).toBe(true);
  });
  it("attend les choix validés pour une page filtrée", () => {
    expect(classFilterReadyForPage("school::parent", "", false, true, false)).toBe(false);
    expect(classFilterReadyForPage("school::parent", "", true, false, false)).toBe(false);
    expect(classFilterReadyForPage("school::parent", "", true, true, false)).toBe(true);
    expect(classFilterReadyForPage("school::parent", "Option", true, true, false)).toBe(false);
    expect(classFilterReadyForPage("school::parent", "Option", true, true, true)).toBe(true);
  });
});
