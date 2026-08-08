import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firebaseAdminPublicError } from "../../api/_lib/firebaseAdmin.js";

describe("diagnostic public Firebase Admin", () => {
  it("masque une configuration interne et fournit un identifiant de corrélation", () => {
    const diagnostic = firebaseAdminPublicError(new Error("Configuration Firebase Admin manquante: FIREBASE_SERVICE_ACCOUNT_JSON est obligatoire pour cet environnement."));
    expect(diagnostic).toMatchObject({
      code: "firebase-admin/configuration-error",
      message: "Le service est temporairement indisponible.",
    });
    expect(diagnostic.correlationId).toMatch(/^acadea-/);
    expect(JSON.stringify(diagnostic)).not.toContain("FIREBASE_SERVICE_ACCOUNT_JSON");
  });

  it("conserve le vrai code Firebase Auth", () => {
    const error = Object.assign(new Error("Email already exists"), { code: "auth/email-already-exists" });
    expect(firebaseAdminPublicError(error)).toEqual({ code: "auth/email-already-exists", message: "Un compte utilise déjà cette adresse e-mail." });
  });

  it("ne divulgue pas les détails d'une erreur interne inconnue", () => {
    const diagnostic = firebaseAdminPublicError(new Error("private internal detail"));
    expect(diagnostic).toMatchObject({
      code: "internal",
      message: "Le service est temporairement indisponible.",
    });
    expect(diagnostic.correlationId).toMatch(/^acadea-/);
    expect(JSON.stringify(diagnostic)).not.toContain("private internal detail");
  });
  it("ne conserve ni UID, ni e-mail, ni claims dans les diagnostics d'authentification navigateur", () => {
    const source = readFileSync("src/services/auth.ts", "utf8");
    expect(source).not.toContain("__authDiagnostic");
    expect(source).not.toContain("firebaseUid");
    expect(source).not.toContain("customClaims");
    expect(source).not.toContain("firestoreDocument: null");
    const refreshSource = readFileSync("src/utils/refreshErrors.ts", "utf8");
    expect(refreshSource).not.toContain("userId:");
    expect(refreshSource).not.toContain("errorStack:");
    expect(refreshSource).not.toContain("errorMessage:");
    for (const apiPath of ["api/manage-school.js", "api/provision-school-admin.js", "api/provision-school-account.js"]) {
      expect(readFileSync(apiPath, "utf8")).not.toContain("details: diagnostic");
    }
  });
});
