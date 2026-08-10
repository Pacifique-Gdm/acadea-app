import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/services/auth.ts", "utf8");

describe("blocage Auth des personnels archivés", () => {
  it("bloque les deux représentations de statut au bootstrap et dans les guards", () => {
    expect(source).toContain('firestoreDocument.status === "inactive" || firestoreDocument.active === false');
    expect(source).toContain('user.status === "inactive" || user.active === false');
    expect(source).toContain("Votre compte n’est plus actif dans cet établissement.");
  });

  it("écoute le profil en temps réel et ferme une session devenue inactive", () => {
    expect(source).toContain('onSnapshot(doc(db!, "users", firebaseUser.uid)');
    expect(source).toContain("void authModule.signOut(auth)");
    expect(source).toContain("profileUnsubscribe?.()");
  });
});
