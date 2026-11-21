import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// P4, lot 3 : vérifie le branchement dans App.tsx (ces contrôles échouent sur le code d'avant le lot 3).
const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("const applyAuthenticatedUser = useCallback(");
const applyAuthenticatedUser = source.slice(start, source.indexOf("}, [navigate]);", start));

describe("P4 lot 3 — fin de session automatique et changement de compte", () => {
  it("la branche « plus d'utilisateur » appelle le nettoyage, décidé selon l'état du réseau", () => {
    const signedOut = applyAuthenticatedUser.slice(applyAuthenticatedUser.indexOf("if (!nextUser) {"));
    expect(signedOut).toContain("cleanAfterSignedOut(decideSignedOutCleanup({");
    expect(signedOut).toContain("online: typeof navigator === \"undefined\" ? undefined : navigator.onLine");
    expect(signedOut).toContain("logoutInProgress: logoutInProgressRef.current");
    // La décision lit l'identifiant précédent AVANT qu'il soit remis à zéro.
    expect(signedOut.indexOf("previousUserId: authenticatedUserIdRef.current")).toBeLessThan(signedOut.indexOf("authenticatedUserIdRef.current = \"\""));
  });

  it("un changement d'identifiant remet les données à zéro et vide les caches ; le même identifiant ne vide rien", () => {
    const sameAccount = applyAuthenticatedUser.indexOf("if (transition === \"same-account\") {");
    const switchBlock = applyAuthenticatedUser.slice(applyAuthenticatedUser.indexOf("if (transition === \"account-switch\") {"));
    expect(sameAccount).toBeGreaterThan(0);
    expect(applyAuthenticatedUser.slice(sameAccount, sameAccount + 120)).toContain("setUser(nextUser);\n      return;");
    expect(switchBlock).toContain("setData(loadInitialData());");
    expect(switchBlock).toContain("void cleanAfterAccountSwitch();");
    expect(switchBlock).toContain("setOfflineAccess(null);");
    // L'écran reste masqué (chargement) jusqu'aux données du nouveau compte.
    expect(switchBlock).toContain("setDataLoading(nextUser.role !== \"super_admin\");");
  });

  it("une erreur définitive de session (compte désactivé, droits retirés) nettoie aussi, en ligne seulement", () => {
    const errorBranch = source.slice(source.indexOf('console.error("[Acadéa auth] Session Firebase invalide."'));
    expect(errorBranch.slice(0, 2500)).toContain("void cleanAfterSignedOut(decideSessionErrorCleanup({");
    // La reprise hors ligne (erreur de réseau sans connexion) est traitée AVANT et ne passe pas par ce nettoyage.
    expect(errorBranch.indexOf("if (networkFailure && offlineUid) {")).toBeLessThan(errorBranch.indexOf("decideSessionErrorCleanup({"));
  });

  it("le billet hors ligne et la copie de référence du nouveau compte sont écrits après le nettoyage", () => {
    expect(source).toContain("afterSessionCleanup(() => rememberOfflineAccess({");
    expect(source).toContain("afterSessionCleanup(() => prepareOfflineContext(user, school, selectedYear))");
  });
});
