import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("résilience du bootstrap authentifié", () => {
  const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const bootstrapFailureStart = appSource.indexOf("Chargement initial Firestore indisponible sans invalidation de session");
  const bootstrapFailureEnd = appSource.indexOf("} finally", bootstrapFailureStart);
  const bootstrapFailure = appSource.slice(bootstrapFailureStart, bootstrapFailureEnd);

  it("conserve la session Firebase et la route lors d'une erreur de données", () => {
    expect(bootstrapFailureStart).toBeGreaterThan(-1);
    expect(bootstrapFailure).toContain("setBootstrapError");
    expect(bootstrapFailure).not.toContain("signOutUser");
    expect(bootstrapFailure).not.toContain('navigate("/login")');
    expect(bootstrapFailure).not.toContain("setUser(null)");
  });

  it("propose une relance sans reconnexion", () => {
    expect(appSource).toContain("Votre session reste active");
    expect(appSource).toContain("setBootstrapRetry((value) => value + 1)");
    expect(appSource.indexOf("if (bootstrapError)")).toBeLessThan(appSource.indexOf("|| !school)"));
  });
});
