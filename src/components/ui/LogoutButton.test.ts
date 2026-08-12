import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bouton Déconnexion partagé", () => {
  const component = readFileSync("src/components/ui/LogoutButton.tsx", "utf8");
  const adminMenu = readFileSync("src/modules/menu/MenuModule.tsx", "utf8");
  const teacherMenu = readFileSync("src/modules/teacher/TeacherPortal.tsx", "utf8");

  it("réutilise le même composant, les mêmes classes et la même icône", () => {
    expect(component).toContain("logoutButtonClassName");
    expect(component).toContain("<LogOut");
    expect(adminMenu).toContain("<LogoutButton onClick={onLogout}");
    expect(teacherMenu).toContain("<LogoutButton onClick={onLogout}");
  });
});
