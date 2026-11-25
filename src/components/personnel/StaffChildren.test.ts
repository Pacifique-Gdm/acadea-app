import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { staffChildSupportLabel } from "../../services/staffChildren";
import { STAFF_NO_CHILDREN_MESSAGE } from "./StaffChildrenContent";
import { teacherTabs } from "../layout/teacherNavigation";

const read = (path: string) => readFileSync(path, "utf8");

describe("lot 3 : « Enfants » pour le personnel (écran)", () => {
  it("dit ce que l'enfant paie selon la décision : rien, la moitié ou une réduction", () => {
    expect(staffChildSupportLabel({ nature: "full", lines: {} })).toBe("Prise en charge : rien à payer");
    expect(staffChildSupportLabel({ nature: "percent", lines: { a: { value: 50 }, b: { value: 50 } } })).toBe("Prise en charge : la moitié");
    expect(staffChildSupportLabel({ nature: "percent", lines: { a: { value: 30 } } })).toBe("Prise en charge : réduction accordée");
    expect(staffChildSupportLabel({ nature: "fixed", lines: { a: { value: 20 } } })).toBe("Prise en charge : réduction accordée");
  });

  it("message professionnel quand aucun enfant n'est à charge", () => {
    expect(STAFF_NO_CHILDREN_MESSAGE).toBe("Aucun enfant à votre charge n'est enregistré dans cet établissement.");
  });

  it("enseignant : onglet « Enfants » entre « Mon horaire » et « Menu »", () => {
    const labels = teacherTabs.map((tab) => tab.label);
    expect(labels.indexOf("Enfants")).toBe(labels.indexOf("Mon horaire") + 1);
    expect(labels.indexOf("Menu")).toBe(labels.indexOf("Enfants") + 1);
    expect(read("src/modules/teacher/TeacherPortal.tsx")).toContain('{activeTab === "children" && <StaffChildrenContent school={school} />}');
  });

  it("directeur de discipline et caissier (4 onglets) : onglet « Enfants » avant « Menu »", () => {
    const discipline = read("src/components/layout/DisciplineBottomNavigation.tsx");
    expect(discipline.indexOf('label: "Enfants"')).toBeLessThan(discipline.indexOf('label: "Menu"'));
    expect(read("src/modules/discipline/DisciplinePortal.tsx")).toContain('{activeDisciplineTab === "children" && <StaffChildrenContent school={school} />}');
    const bottom = read("src/components/layout/BottomNavigation.tsx");
    expect(bottom).toContain('user.role === "cashier" ? ["dashboard", "control", "messages", "children", "menu"].includes(tab.id) : tab.id !== "children"');
    expect(read("src/App.tsx")).toContain('activeTab === "children" && user.role === "cashier" && <StaffChildrenContent school={school} />');
  });

  it("administrateur, secrétaire et direction des études (5 onglets) : bouton « Enfants » dans le Menu", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('{user.role === "school_admin" && <StaffChildrenEntry school={school} />}');
    expect(app).toContain('renderStaffChildren={() => <StaffChildrenEntry school={school} />}');
    expect(read("src/modules/studies/StudyDirectorPortal.tsx")).toContain("<StaffChildrenEntry school={school} />");
  });
});
