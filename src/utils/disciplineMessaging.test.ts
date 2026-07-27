import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("messagerie du Directeur de Discipline", () => {
  it("possède un contenu défilant et une fermeture explicite réouvrable", () => {
    const drawer = readFileSync(new URL("../components/ui/AdminDrawer.tsx", import.meta.url), "utf8");
    const messages = readFileSync(new URL("../components/messages/MessageDrawerContent.tsx", import.meta.url), "utf8");
    const portal = readFileSync(new URL("../modules/discipline/DisciplinePortal.tsx", import.meta.url), "utf8");
    expect(messages).toContain("overflow-y-auto");
    expect(drawer).toContain("onClick={onClose}");
    expect(drawer).toContain('document.body.style.overflow = previousBodyOverflow');
    expect(portal).toContain("setNotificationsOpen(false)");
    expect(portal).toContain("setNotificationsOpen(true)");
  });
});
