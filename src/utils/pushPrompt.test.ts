import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectPushDevice, needsIosInstall, PUSH_PROMPT_DELAY_MS, pushPromptDue } from "./pushPrompt";

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
    expect(auth.indexOf("forgetDevicePushToken(uid)")).toBeLessThan(auth.indexOf("await authModule.signOut(auth);\n}"));
    expect(push).toContain("export async function forgetDevicePushToken(userId: string)");
    expect(push).not.toContain('return user.role === "parent" && user.status');
  });
  it("le réglage « Notifications » est présent dans le Menu de chaque espace", () => {
    for (const file of ["../App.tsx", "../modules/coordination/CoordinationPortal.tsx", "../modules/teacher/TeacherPortal.tsx", "../modules/studies/StudyDirectorPortal.tsx", "../modules/platform/PlatformModule.tsx"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).toContain("<PushNotificationSettings user={user} />");
    }
  });
});
