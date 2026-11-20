import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { logoutDraftsMessage } from "./LogoutDraftsDialog";
import { UNSENT_OFFLINE_STATUSES, countUnsentRows } from "../../services/offlineQueue";

const scope = (userId: string) => ({ userId, schoolId: "s", schoolYearId: "y" });

describe("P4 lot 1 : avertissement des brouillons non envoyés", () => {
  it("compte seulement les brouillons non envoyés de CE compte, toutes écoles confondues", () => {
    const rows = [
      { scope: scope("a"), status: "LOCAL_PENDING" as const },
      { scope: { userId: "a", schoolId: "autre", schoolYearId: "z" }, status: "RETRYABLE_ERROR" as const },
      { scope: scope("a"), status: "CONFLICT" as const },
      { scope: scope("a"), status: "REJECTED" as const },
      { scope: scope("a"), status: "SERVER_CONFIRMED" as const },
      { scope: scope("b"), status: "LOCAL_PENDING" as const },
    ];
    expect(countUnsentRows(rows, "a")).toBe(4);
    expect(countUnsentRows(rows, "b")).toBe(1);
    expect(countUnsentRows(rows, "c")).toBe(0);
    expect(UNSENT_OFFLINE_STATUSES).not.toContain("SERVER_CONFIRMED");
  });

  it("dit que les brouillons restent sur l'appareil (singulier et pluriel)", () => {
    expect(logoutDraftsMessage(1)).toBe("Vous avez 1 brouillon non envoyé sur cet appareil. Il restera ici, réservé à votre compte, et sera envoyé à votre prochaine connexion.");
    expect(logoutDraftsMessage(3)).toContain("3 brouillons non envoyés");
    expect(logoutDraftsMessage(3)).toContain("Ils resteront ici, réservés à votre compte");
  });

  it("la déconnexion demande confirmation AVANT de vider l'écran, et ne supprime aucun brouillon", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const body = app.slice(app.indexOf("async function logout()"), app.indexOf("function updateData("));
    expect(body.indexOf("countUnsentOfflineOperations")).toBeGreaterThan(-1);
    expect(body.indexOf("confirmLogoutWithDrafts")).toBeLessThan(body.indexOf("setUser(null)"));
    expect(body).toMatch(/if \(unsentDrafts > 0 && !\(await confirmLogoutWithDrafts\(unsentDrafts\)\)\) return;/);
    expect(body).not.toMatch(/abandonFailedOfflineOperation|deleteOfflineOperation|clearOffline(Queue|Operations)/);
    const dialog = readFileSync("src/components/auth/LogoutDraftsDialog.tsx", "utf8");
    expect(dialog).toContain("Rester connecté");
    expect(dialog).toContain("Me déconnecter quand même");
  });
});
