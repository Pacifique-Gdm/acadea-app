import { describe, expect, it } from "vitest";
import { firebaseAdminPublicError } from "../../api/_lib/firebaseAdmin.js";

describe("diagnostic public Firebase Admin", () => {
  it("expose un code exploitable sans masquer une configuration absente", () => {
    const diagnostic = firebaseAdminPublicError(new Error("Configuration Firebase Admin manquante: FIREBASE_SERVICE_ACCOUNT_JSON est obligatoire pour cet environnement."));
    expect(diagnostic).toEqual({
      code: "firebase-admin/configuration-error",
      details: "Configuration Firebase Admin manquante: FIREBASE_SERVICE_ACCOUNT_JSON est obligatoire pour cet environnement.",
    });
  });

  it("conserve le vrai code Firebase Auth", () => {
    const error = Object.assign(new Error("Email already exists"), { code: "auth/email-already-exists" });
    expect(firebaseAdminPublicError(error)).toEqual({ code: "auth/email-already-exists", details: "Email already exists" });
  });

  it("ne divulgue pas les détails d'une erreur interne inconnue", () => {
    expect(firebaseAdminPublicError(new Error("private internal detail"))).toEqual({
      code: "internal",
      details: "Erreur interne du service de provisionnement.",
    });
  });
});
