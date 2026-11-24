import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resetTabScroll } from "./tabScrollReset";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("changement d'onglet : l'écran s'ouvre toujours tout en haut", () => {
  it("remet en haut le <main> qui défile, la page et la fenêtre", () => {
    const mains = [{ scrollTop: 840 }, { scrollTop: 120 }];
    const page = { scrollTop: 300 };
    const calls: Array<[number, number]> = [];
    resetTabScroll({ querySelectorAll: (selector) => (selector === "main" ? mains : []), scrollingElement: page }, { scrollTo: (x, y) => calls.push([x, y]) });
    expect(mains.map((main) => main.scrollTop)).toEqual([0, 0]);
    expect(page.scrollTop).toBe(0);
    expect(calls).toEqual([[0, 0]]);
  });

  it("ne plante pas sans document (rendu serveur, tests)", () => {
    expect(() => resetTabScroll(undefined, undefined)).not.toThrow();
  });

  it("la barre d'onglets commune déclenche la remise en haut à chaque changement d'onglet", () => {
    const component = read("./MobileBottomNavigation.tsx");
    expect(component).toContain('import { resetTabScroll } from "./tabScrollReset";');
    const effect = component.slice(component.indexOf("useLayoutEffect(() => {"), component.indexOf("}, [activeId]);"));
    expect(effect).toContain("if (previousActiveId.current === activeId) return;");
    expect(effect).toContain("resetTabScroll();");
  });

  it("tous les portails passent par cette barre commune", () => {
    for (const path of [
      "./BottomNavigation.tsx",
      "./SecretaryBottomNavigation.tsx",
      "./StudyDirectorBottomNavigation.tsx",
      "./TeacherBottomNavigation.tsx",
      "./ParentBottomNavigation.tsx",
      "./DisciplineBottomNavigation.tsx",
      "../../modules/platform/PlatformModule.tsx",
      "../../modules/coordination/CoordinationPortal.tsx",
    ]) expect(read(path)).toContain("<MobileBottomNavigation");
  });
});
