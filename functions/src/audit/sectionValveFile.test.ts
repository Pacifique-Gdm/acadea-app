import { describe, expect, it } from "vitest";
import { assertSectionValveFile } from "./sectionValveFile.js";
const token = { role: "primary_admin", schoolId: "a" };
const profile = { ...token, status: "active", sectionIds: ["Primaire"] };
const school = { status: "active" };
const path = "valves/a/y/v/file.pdf";
const valve = { schoolId: "a", schoolYearId: "y", visibility: "Primaire", attachments: [{ path, name: "Test", type: "application/pdf", size: 10 }] };
describe("section valve attachments", () => {
  it("authorizes only an explicitly scoped registered file", () => {
    expect(assertSectionValveFile(token, profile, school, valve, "v", path)).toEqual({ path, name: "Test", type: "application/pdf", size: 10 });
  });
  it.each([{ visibility: "Secondaire" }, { visibility: "all_parents" }, { schoolId: "b" }, { attachments: [] }])("rejects foreign or unregistered files", (patch) => {
    expect(() => assertSectionValveFile(token, profile, school, { ...valve, ...patch }, "v", path)).toThrow();
  });
  it.each([{ status: "inactive" }, { active: false }, { sectionIds: [] }, { sectionIds: ["Unknown"] }, { schoolId: "b" }])("rejects revoked or invalid profiles", (patch) => {
    expect(() => assertSectionValveFile(token, { ...profile, ...patch }, school, valve, "v", path)).toThrow();
  });
  it("rejects path manipulation and an inactive school", () => {
    expect(() => assertSectionValveFile(token, profile, school, valve, "v", "valves/b/y/v/file.pdf")).toThrow();
    expect(() => assertSectionValveFile(token, profile, { status: "suspended" }, valve, "v", path)).toThrow();
  });
});
