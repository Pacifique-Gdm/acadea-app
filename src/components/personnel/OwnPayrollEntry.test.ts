import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppUser, School } from "../../types";
import { OwnPayrollEntry } from "./OwnPayrollEntry";

const school = { id: "school-a" } as School;

describe("entrée Salaire/Prime", () => {
  it.each(["school_admin", "secretary", "study_director", "discipline_director", "cashier", "teacher"] as const)("affiche une carte avec icône pour %s", (role) => {
    const user = { role, schoolId: school.id } as AppUser;
    const html = renderToStaticMarkup(createElement(OwnPayrollEntry, { user, school }));
    expect(html).toContain("Salaire/Prime");
    expect(html).toContain("lucide-banknote");
    expect(html).toContain('type="button"');
  });

  it("ne propose pas la carte à un utilisateur d'une autre école", () => {
    const html = renderToStaticMarkup(createElement(OwnPayrollEntry, { user: { role: "teacher", schoolId: "school-b" } as AppUser, school }));
    expect(html).not.toContain("Salaire/Prime");
  });
});
