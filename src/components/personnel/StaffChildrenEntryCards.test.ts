import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { School } from "../../types";
import { StaffChildrenEntry } from "./StaffChildrenContent";

// Carte « Enfants » au modèle des autres cartes de chaque Menu, et icône propre à « Bibliothèque »
// (maquette validée par l'utilisateur le 28/11/2026).
const school = { id: "ecole-1", name: "École" } as School;
const card = (menu?: "admin" | "secretary") => renderToStaticMarkup(createElement(StaffChildrenEntry, { school, menu }));
const source = (path: string) => readFileSync(path, "utf8");
const constant = (path: string, name: string) => {
  const match = source(path).match(new RegExp(`const ${name} = "([^"]+)";`));
  if (!match) throw new Error(`${name} introuvable dans ${path}`);
  return match[1];
};
const buttonClass = (html: string) => html.match(/^<button[^>]*class="([^"]+)"/)![1];
// Le « carré » : l'élément qui entoure directement l'icône (svg).
const squareClass = (html: string) => html.match(/<span class="([^"]+)"><svg/)?.[1] ?? null;

describe("carte « Enfants » : même carré que les autres cartes de chaque Menu", () => {
  it("Administrateur d'école : carré gris des cartes du Menu", () => {
    const square = "flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink";
    expect(squareClass(card("admin"))).toBe(square);
    // Les cartes voisines du même Menu utilisent ce même carré.
    expect(source("src/modules/menu/MenuModule.tsx")).toContain(`<div className="${square}">`);
    expect(source("src/modules/menu/FeeAllocationDrawer.tsx")).toContain(`<span className="${square}">`);
    expect(source("src/components/personnel/OwnPayrollEntry.tsx")).toContain(`<span className="${square}">`);
    expect(card("admin")).toContain("Enfants à votre charge dans cet établissement");
  });

  it("Secrétariat : carré bleu et carte des autres entrées du Menu", () => {
    const path = "src/modules/secretary/SecretaryMenuModule.tsx";
    expect(squareClass(card("secretary"))).toBe(constant(path, "menuIconClass"));
    expect(buttonClass(card("secretary"))).toBe(constant(path, "menuButtonClass"));
  });

  it("Direction des études et conseillers : même carte que leurs voisines (icône sans carré)", () => {
    const html = card();
    expect(squareClass(html)).toBeNull();
    expect(html).toMatch(/^<button[^>]*><svg/);
    for (const path of ["src/modules/studies/StudyDirectorPortal.tsx", "src/modules/advisors/OrientationAdvisorPortal.tsx", "src/modules/advisors/PedagogicalAdvisorPortal.tsx"]) {
      expect(buttonClass(html)).toBe(constant(path, "menuButton"));
      expect(source(path)).toContain("<StaffChildrenEntry school={school} />");
    }
  });

  it("chaque Menu reçoit le bon modèle (administrateur d'école et secrétariat)", () => {
    const app = source("src/App.tsx");
    expect(app).toContain('renderStaffChildren={() => <StaffChildrenEntry school={school} menu="secretary" />}');
    expect(app).toContain('renderStaffChildren={() => <>{user.role === "school_admin" && <StaffChildrenEntry school={school} menu="admin" />}</>}');
  });
});

describe("« Bibliothèque » n'a plus la même icône que « Valves »", () => {
  const menus = [
    "src/modules/menu/MenuModule.tsx",
    "src/modules/secretary/SecretaryMenuModule.tsx",
    "src/modules/studies/StudyDirectorPortal.tsx",
    "src/modules/advisors/OrientationAdvisorPortal.tsx",
    "src/modules/advisors/PedagogicalAdvisorPortal.tsx",
    "src/modules/teacher/TeacherPortal.tsx",
    "src/modules/parent/ParentPortal.tsx",
    "src/modules/discipline/DisciplinePortal.tsx",
  ];
  it.each(menus)("%s : icône « rayonnage » (Library) pour Bibliothèque", (path) => {
    const text = source(path);
    const index = text.indexOf("Bibliothèque");
    const before = text.slice(Math.max(0, index - 220), index);
    const after = text.slice(index, index + 120);
    const near = /icon: \w+/.test(after) ? after : before;
    expect(near).toMatch(/<Library |icon: Library/);
    expect(near.slice(near.search(/<Library |icon: Library/) - 1)).not.toMatch(/<BookOpen |icon: BookOpen/);
    expect(text).toMatch(/import \{[^}]*\bLibrary\b[^}]*\} from "lucide-react";/);
  });

  it("Menu de l'administrateur : Valves garde le livre ouvert, Bibliothèque a le rayonnage", () => {
    const text = source("src/modules/menu/MenuModule.tsx");
    expect(text).toMatch(/\{ id: "valves", title: "Valves", [^}]*icon: BookOpen \}/);
    expect(text).toMatch(/\{ id: "library", title: "Bibliothèque", [^}]*icon: Library \}/);
    const secretary = source("src/modules/secretary/SecretaryMenuModule.tsx");
    expect(secretary).toMatch(/<BookOpen className="h-5 w-5" \/><\/span><span className="font-bold text-ink">Valves/);
    expect(secretary).toMatch(/<Library className="h-5 w-5" \/><\/span><span className="font-bold text-ink">Bibliothèque/);
  });
});
