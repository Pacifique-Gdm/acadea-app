import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Menu et messagerie Enseignant / Direction des études", () => {
  const teacher = readFileSync("src/modules/teacher/TeacherPortal.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const header = readFileSync("src/components/layout/Header.tsx", "utf8");

  it("retire uniquement Assistant IA et Notifications du Menu Enseignant", () => {
    expect(teacher).not.toContain('"Assistant IA"');
    expect(teacher).not.toContain('"Notifications"');
    for (const label of ["Ma progression pédagogique", "Mes disponibilités", "Documents pédagogiques", "Mes demandes"]) expect(teacher).toContain(label);
  });

  it("active la boîte partagée pour les deux portails avec badge et callbacks temps réel", () => {
    expect(app.match(/messagingEnabled \/>/g)).toHaveLength(2);
    expect(app.match(/onToggleNotifications=\{openNotifications\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(app.match(/recipientUserId === user.id/g)?.length).toBeGreaterThanOrEqual(2);
    expect(header).toContain("manualRefreshToken");
    expect(header).toContain("refreshHeaderData");
    expect(header).toContain('aria-label="Boîte à Messagerie"');
  });
});
