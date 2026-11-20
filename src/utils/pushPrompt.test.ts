import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectPushDevice, needsIosInstall, PUSH_PROMPT_DELAY_MS, PUSH_STATUS_RECHECK_MS, pushPromptDue, pushPromptVisible, pushSettingsVisible } from "./pushPrompt";

describe("lot 24 : bandeau d'activation des notifications", () => {
  it("« Plus tard » : redemande au plus une fois tous les 3 jours", () => {
    const now = Date.parse("2026-11-16T10:00:00Z");
    expect(pushPromptDue(null, now)).toBe(true);
    expect(pushPromptDue(new Date(now - PUSH_PROMPT_DELAY_MS + 60_000).toISOString(), now)).toBe(false);
    expect(pushPromptDue(new Date(now - PUSH_PROMPT_DELAY_MS).toISOString(), now)).toBe(true);
    expect(pushPromptDue("valeur abîmée", now)).toBe(true);
  });
  it("sur iPhone, demande d'abord l'installation sur l'écran d'accueil", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
    expect(needsIosInstall(detectPushDevice(iphone, false))).toBe(true);
    expect(needsIosInstall(detectPushDevice(iphone, true))).toBe(false);
    expect(needsIosInstall(detectPushDevice("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile", false))).toBe(false);
  });
  it("le jeton de l'appareil est retiré à la déconnexion, tous les rôles peuvent activer", () => {
    const auth = readFileSync(new URL("../services/auth.ts", import.meta.url), "utf8").split("\r\n").join("\n");
    const push = readFileSync(new URL("../services/pushNotifications.ts", import.meta.url), "utf8");
    // P4 lot 1 : le retrait (borné à 3 s) est passé à la séquence qui appelle ensuite toujours signOut.
    expect(auth.indexOf("forgetDevicePushToken(uid)")).toBeGreaterThan(auth.indexOf("forgetTokenThenSignOut({"));
    expect(auth.indexOf("forgetDevicePushToken(uid)")).toBeLessThan(auth.indexOf("signOut: () => authModule.signOut(auth)"));
    expect(push).toContain("export async function forgetDevicePushToken(userId: string)");
    expect(push).not.toContain('return user.role === "parent" && user.status');
  });
  it("le réglage « Notifications » est présent dans le Menu de chaque espace", () => {
    for (const file of ["../App.tsx", "../modules/coordination/CoordinationPortal.tsx", "../modules/teacher/TeacherPortal.tsx", "../modules/studies/StudyDirectorPortal.tsx", "../modules/platform/PlatformModule.tsx"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).toContain("<PushNotificationSettings user={user} />");
    }
  });
});

describe("lot 26 : réglage et bandeau masqués quand les notifications sont actives", () => {
  const android = { ios: false, android: true, standalone: false };
  it("le réglage du Menu disparaît quand elles sont actives et revient dès qu'elles ne le sont plus", () => {
    expect(pushSettingsVisible("enabled")).toBe(false);
    expect(pushSettingsVisible("loading")).toBe(false);
    // Déconnexion, nouvel appareil ou jeton invalide supprimé : l'état redevient « available ».
    expect(pushSettingsVisible("available")).toBe(true);
    // Autorisation retirée dans les réglages du téléphone.
    expect(pushSettingsVisible("blocked")).toBe(true);
  });
  it("le bandeau suit la même logique, en respectant « Plus tard »", () => {
    expect(pushPromptVisible("enabled", android, true)).toBe(false);
    expect(pushPromptVisible("available", android, true)).toBe(true);
    expect(pushPromptVisible("blocked", android, true)).toBe(true);
    expect(pushPromptVisible("available", android, false)).toBe(false);
    expect(pushPromptVisible("unsupported", android, true)).toBe(false);
    expect(pushPromptVisible("unsupported", { ios: true, android: false, standalone: false }, true)).toBe(true);
  });
  it("revérifie l'état automatiquement au moins chaque minute", () => {
    expect(PUSH_STATUS_RECHECK_MS).toBeLessThanOrEqual(60_000);
  });
});
