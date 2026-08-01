import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FirestoreDataError, getYearRefreshScope } from "../services/firestoreData";
import { firebaseErrorCode, refreshErrorMessage } from "./refreshErrors";

describe("actualisation Firestore", () => {
  it("conserve le code et la collection de l'erreur Firebase réelle", () => {
    const error = new FirestoreDataError("expenses", { code: "permission-denied", message: "denied" });
    expect(error.code).toBe("permission-denied");
    expect(error.collectionPath).toBe("expenses");
    expect(firebaseErrorCode(error)).toBe("permission-denied");
  });

  it.each([
    ["permission-denied", "autorisation"],
    ["unavailable", "temporairement indisponible"],
    ["unauthenticated", "session a expiré"],
    ["failed-precondition", "configuration supplémentaire"],
    ["deadline-exceeded", "trop de temps"],
    ["unknown", "contactez l'assistance"],
  ])("affiche un message utile pour %s", (code, expected) => {
    expect(refreshErrorMessage({ code })).toContain(expected);
  });

  it("utilise un périmètre réduit pour le Secrétaire", () => {
    expect(getYearRefreshScope("secretary")).toBe("secretary");
    expect(getYearRefreshScope("school_admin")).toBe("school");
    expect(getYearRefreshScope("cashier")).toBe("school");
  });

  it("ne lit pas les collections financières interdites pendant l'actualisation Secrétaire", () => {
    const source = readFileSync(new URL("../services/firestoreData.ts", import.meta.url), "utf8");
    const secretaryBranch = source.slice(source.indexOf('if (getYearRefreshScope(user.role) === "secretary")'), source.indexOf("const yearData: FirestoreYearData"));
    expect(secretaryBranch).toContain('"students"');
    expect(secretaryBranch).toContain('"parents"');
    expect(secretaryBranch).toContain('"feeTypes"');
    expect(secretaryBranch).toContain('"payments"');
    expect(secretaryBranch).not.toContain('"expenses"');
    expect(secretaryBranch).not.toContain('"messages"');
  });

  it("verrouille les doubles clics et libère toujours l'actualisation", () => {
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(source).toContain("refreshInFlightRef.current ||");
    expect(source).toContain("runRefreshTask({ lock: refreshInFlightRef");
  });
});
