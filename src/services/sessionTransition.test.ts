import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  afterSessionCleanup,
  classifyAuthTransition,
  cleanAfterAccountSwitch,
  cleanAfterSignedOut,
  decideSignedOutCleanup,
  resetSessionCleanupQueueForTests,
} from "./sessionTransition";

function deps(leftover: unknown = null) {
  return {
    clearAccess: vi.fn(async () => undefined),
    cleanDevice: vi.fn(async () => ({})),
    readLeftoverAccess: vi.fn(async () => leftover),
  };
}

beforeEach(() => resetSessionCleanupQueueForTests());

describe("P4 lot 3 — passage d'un compte à l'autre", () => {
  it("le même identifiant (mise à jour du profil) n'est pas un changement de compte", () => {
    expect(classifyAuthTransition("compte-a", "compte-a")).toBe("same-account");
  });
  it("un autre identifiant est un changement de compte", () => {
    expect(classifyAuthTransition("compte-a", "compte-b")).toBe("account-switch");
  });
  it("première connexion et fin de session", () => {
    expect(classifyAuthTransition("", "compte-a")).toBe("first-sign-in");
    expect(classifyAuthTransition("compte-a", null)).toBe("signed-out");
    expect(classifyAuthTransition("", undefined)).toBe("signed-out");
  });
});

describe("P4 lot 3 — fin de session automatique", () => {
  it("en ligne après une session : nettoyage complet", () => {
    expect(decideSignedOutCleanup({ previousUserId: "compte-a", online: true, logoutInProgress: false })).toBe("clean");
  });
  it("hors ligne ou réseau inconnu : rien n'est effacé (reprise hors ligne)", () => {
    expect(decideSignedOutCleanup({ previousUserId: "compte-a", online: false, logoutInProgress: false })).toBe("none");
    expect(decideSignedOutCleanup({ previousUserId: "", online: false, logoutInProgress: false })).toBe("none");
    expect(decideSignedOutCleanup({ previousUserId: "compte-a", online: undefined, logoutInProgress: false })).toBe("none");
  });
  it("pendant une déconnexion manuelle : rien ici (logout s'en charge)", () => {
    expect(decideSignedOutCleanup({ previousUserId: "compte-a", online: true, logoutInProgress: true })).toBe("none");
  });
  it("en ligne à l'ouverture : nettoyage seulement s'il reste un billet d'une session mal fermée", () => {
    expect(decideSignedOutCleanup({ previousUserId: "", online: true, logoutInProgress: false })).toBe("clean-if-leftover");
  });

  it("« clean » efface le billet hors ligne puis nettoie l'appareil", async () => {
    const d = deps();
    await expect(cleanAfterSignedOut("clean", d)).resolves.toBe(true);
    expect(d.clearAccess).toHaveBeenCalledTimes(1);
    expect(d.cleanDevice).toHaveBeenCalledTimes(1);
  });
  it("« none » ne touche à rien", async () => {
    const d = deps({ userId: "compte-a" });
    await expect(cleanAfterSignedOut("none", d)).resolves.toBe(false);
    expect(d.clearAccess).not.toHaveBeenCalled();
    expect(d.cleanDevice).not.toHaveBeenCalled();
  });
  it("« clean-if-leftover » sans billet restant : rien n'est fait", async () => {
    const d = deps(null);
    await expect(cleanAfterSignedOut("clean-if-leftover", d)).resolves.toBe(false);
    expect(d.cleanDevice).not.toHaveBeenCalled();
  });
  it("« clean-if-leftover » avec un billet restant : nettoyage", async () => {
    const d = deps({ userId: "compte-a" });
    await expect(cleanAfterSignedOut("clean-if-leftover", d)).resolves.toBe(true);
    expect(d.clearAccess).toHaveBeenCalledTimes(1);
    expect(d.cleanDevice).toHaveBeenCalledTimes(1);
  });
  it("une erreur de stockage n'empêche pas la suite du nettoyage", async () => {
    const d = deps();
    d.clearAccess.mockRejectedValueOnce(new Error("stockage indisponible"));
    await expect(cleanAfterSignedOut("clean", d)).resolves.toBe(true);
    expect(d.cleanDevice).toHaveBeenCalledTimes(1);
  });
});

describe("P4 lot 3 — ordre nettoyage / préparation du compte suivant", () => {
  it("la préparation hors ligne du nouveau compte attend la fin du nettoyage du précédent", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const switching = cleanAfterAccountSwitch({
      clearAccess: async () => { await gate; order.push("billet précédent effacé"); },
      cleanDevice: async () => { order.push("caches vidés"); },
    });
    const preparing = afterSessionCleanup(async () => { order.push("billet du nouveau compte écrit"); });
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await Promise.all([switching, preparing]);
    expect(order).toEqual(["billet précédent effacé", "caches vidés", "billet du nouveau compte écrit"]);
  });
  it("un nettoyage en échec ne bloque pas la préparation suivante", async () => {
    await cleanAfterAccountSwitch({ clearAccess: async () => { throw new Error("x"); }, cleanDevice: async () => { throw new Error("y"); } });
    await expect(afterSessionCleanup(async () => "prêt")).resolves.toBe("prêt");
  });
});
