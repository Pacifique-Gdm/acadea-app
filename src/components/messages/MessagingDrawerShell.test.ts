import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(new URL("./MessagingDrawerShell.tsx", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("../ui/AdminDrawer.tsx", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../layout/Header.tsx", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("./MessageDrawerContent.tsx", import.meta.url), "utf8");
const bottomNavigationSources = [
  "../layout/BottomNavigation.tsx",
  "../layout/SecretaryBottomNavigation.tsx",
  "../layout/DisciplineBottomNavigation.tsx",
  "../layout/ParentBottomNavigation.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

describe("layout partagé de la Boîte à Messagerie", () => {
  it("réutilise directement le grand Drawer commun depuis le Header de tous les rôles", () => {
    expect(shellSource).toContain("<AdminDrawer");
    expect(headerSource).toContain("<MessagingDrawerShell");
    expect(headerSource).not.toContain("notificationPanel");
  });

  it("reste aligné à droite, pleine hauteur et responsive avec le Drawer Administrateur", () => {
    expect(drawerSource).toContain("fixed inset-0 z-50");
    expect(drawerSource).toContain("ml-auto flex h-full");
    expect(drawerSource).toContain("w-full max-w-xl");
    expect(drawerSource).toContain("overflow-x-hidden overflow-y-auto");
  });

  it("sort du stacking context du Header et reste au-dessus des navigations fixes", () => {
    expect(headerSource).toContain('className="sticky top-0 z-20');
    expect(shellSource).toContain("createPortal(");
    expect(shellSource).toContain("document.body");
    expect(drawerSource).toContain("fixed inset-0 z-50");
    bottomNavigationSources.forEach((source) => expect(source).toContain("z-40"));
  });

  it("conserve le panneau au-dessus du fond overlay dans le même Drawer", () => {
    const overlayIndex = drawerSource.indexOf('className="fixed inset-0 z-50');
    const panelIndex = drawerSource.indexOf('className="ml-auto flex h-full');
    expect(overlayIndex).toBeGreaterThanOrEqual(0);
    expect(panelIndex).toBeGreaterThan(overlayIndex);
  });

  it("conserve un contenu de messagerie flexible sans débordement horizontal", () => {
    expect(contentSource).toContain("flex h-full min-h-0 min-w-0 flex-col");
    expect(contentSource).toContain("overflow-hidden");
    expect(contentSource).toContain("overflow-y-auto");
  });
});
