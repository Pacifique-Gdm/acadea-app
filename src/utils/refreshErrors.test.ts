import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FirestoreDataError, getYearRefreshScope, withFirestoreTimeout } from "../services/firestoreData";
import { firebaseErrorCode, refreshErrorMessage, retryableRefreshError } from "./refreshErrors";

describe("actualisation Firestore", () => {
  it("conserve le code et la collection de l'erreur Firebase réelle", () => {
    const error = new FirestoreDataError("expenses", { code: "permission-denied", message: "denied" });
    expect(error.code).toBe("permission-denied");
    expect(error.collectionPath).toBe("expenses");
    expect(firebaseErrorCode(error)).toBe("permission-denied");
  });

  it("distingue le délai du client d'une panne réseau Firestore", () => {
    const timeout = new FirestoreDataError("feeTypes", { code: "client-timeout", message: "Chargement Firestore trop long : feeTypes." });
    expect(timeout.code).toBe("client-timeout");
    expect(refreshErrorMessage(timeout)).toContain("prend plus de temps que prévu");
    expect(refreshErrorMessage(timeout)).not.toContain("La connexion est lente");
    expect(retryableRefreshError(timeout)).toBe(false);
    expect(refreshErrorMessage({ code: "deadline-exceeded" })).toContain("La connexion est lente");
  });

  it("marque explicitement une lecture lente après 15 secondes, même si la requête réseau reste en cours", async () => {
    vi.useFakeTimers();
    try {
      const pending = new Promise<string>(() => undefined);
      const result = withFirestoreTimeout(pending, "students");
      const rejection = expect(result).rejects.toMatchObject({ code: "client-timeout" });
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["permission-denied", "autorisation"],
    ["unavailable", "temporairement indisponible"],
    ["unauthenticated", "session a expiré"],
    ["failed-precondition", "configuration supplémentaire"],
    ["client-timeout", "prend plus de temps que prévu"],
    ["deadline-exceeded", "connexion est lente"],
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
    const secretaryBranch = source.slice(source.indexOf('if (getYearRefreshScope(user.role) === "secretary")'), source.indexOf("return { students, parents, feeTypes, payments };"));
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
