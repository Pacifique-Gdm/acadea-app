import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AppUser } from "../types";

const firestoreMocks = vi.hoisted(() => ({
  deleteDoc: vi.fn(),
  doc: vi.fn(() => ({ path: "token-document" })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}));
const messagingMocks = vi.hoisted(() => ({
  deleteToken: vi.fn(),
  getMessaging: vi.fn(() => ({ name: "messaging" })),
  getToken: vi.fn(),
  isSupported: vi.fn(),
  foregroundStop: vi.fn(),
  onMessage: vi.fn(),
}));
const pwaMocks = vi.hoisted(() => ({ getServiceWorkerRegistration: vi.fn() }));

vi.mock("@firebase/firestore", () => firestoreMocks);
vi.mock("firebase/messaging", () => messagingMocks);
vi.mock("../firebase", () => ({ app: {}, auth: { currentUser: { uid: "parent-user" } }, db: {}, firebaseReady: true }));
vi.mock("../pwa", () => pwaMocks);

import { disablePushNotifications, enablePushNotifications, getPushNotificationStatus, stopPushForegroundListener } from "./pushNotifications";

const parentUser: AppUser = {
  id: "parent-user",
  name: "Parent Test",
  email: "parent@example.test",
  role: "parent",
  schoolId: "school-a",
  activeSchoolYearId: "year-a",
  parentId: "parent-a",
  status: "active",
};

let permission: NotificationPermission;
let requestPermission: ReturnType<typeof vi.fn>;
let storage: Map<string, string>;

function installBrowserApis() {
  requestPermission = vi.fn(async () => permission);
  class TestNotification {
    static get permission() {
      return permission;
    }

    static requestPermission = requestPermission;
    onclick: (() => void) | null = null;

    close() {}
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: TestNotification });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serviceWorker: {} } });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => "device-new" } });
  Object.defineProperty(globalThis, "dispatchEvent", { configurable: true, value: vi.fn() });
  Object.defineProperty(globalThis, "focus", { configurable: true, value: vi.fn() });
}

beforeEach(() => {
  stopPushForegroundListener();
  vi.clearAllMocks();
  vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "test-vapid-key");
  permission = "default";
  storage = new Map();
  installBrowserApis();
  messagingMocks.isSupported.mockResolvedValue(true);
  messagingMocks.onMessage.mockReturnValue(messagingMocks.foregroundStop);
  messagingMocks.getToken.mockResolvedValue("current-token");
  firestoreMocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  firestoreMocks.setDoc.mockResolvedValue(undefined);
  firestoreMocks.deleteDoc.mockResolvedValue(undefined);
  messagingMocks.deleteToken.mockResolvedValue(true);
  pwaMocks.getServiceWorkerRegistration.mockResolvedValue({ scope: "/" });
});

describe("état silencieux des notifications de paiement", () => {
  it("ne demande jamais l'autorisation pendant la vérification initiale ou l'ouverture du Drawer", async () => {
    await expect(getPushNotificationStatus(parentUser)).resolves.toBe("available");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it("distingue un navigateur incompatible", async () => {
    Reflect.deleteProperty(globalThis, "Notification");
    await expect(getPushNotificationStatus(parentUser)).resolves.toBe("unsupported");
  });

  it("distingue une configuration absente", async () => {
    vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "");
    await expect(getPushNotificationStatus(parentUser)).resolves.toBe("not_configured");
  });

  it("distingue une permission bloquée", async () => {
    permission = "denied";
    await expect(getPushNotificationStatus(parentUser)).resolves.toBe("blocked");
  });

  it("laisse une permission accordée mais sans token réactivable", async () => {
    permission = "granted";
    await expect(getPushNotificationStatus(parentUser)).resolves.toBe("available");
  });

  it("refuse une session non autorisée", async () => {
    await expect(getPushNotificationStatus({ ...parentUser, role: "cashier" })).resolves.toBe("unauthorized");
  });

  it("détecte un appareil déjà enregistré avec son token courant", async () => {
    permission = "granted";
    storage.set("acadea:push-device-id", "device-existing");
    firestoreMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ active: true, token: "current-token" }) });
    await expect(getPushNotificationStatus(parentUser)).resolves.toBe("enabled");
  });
});

describe("activation explicite des notifications Acadéa", () => {
  it("active après demande accordée", async () => {
    permission = "granted";
    await expect(enablePushNotifications(parentUser)).resolves.toMatchObject({ status: "enabled" });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.setDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.setDoc.mock.calls[0]?.[1]).not.toHaveProperty("module");
    expect(firestoreMocks.setDoc.mock.calls[0]?.[1]).not.toHaveProperty("event");
  });

  it("retourne une annulation sans enregistrer de token", async () => {
    permission = "default";
    await expect(enablePushNotifications(parentUser)).resolves.toEqual({ status: "permission-denied" });
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it("mutualise deux activations concurrentes", async () => {
    permission = "granted";
    let releaseToken!: (token: string) => void;
    messagingMocks.getToken.mockImplementation(() => new Promise<string>((resolve) => { releaseToken = resolve; }));
    const first = enablePushNotifications(parentUser);
    const second = enablePushNotifications(parentUser);
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    releaseToken("current-token");
    await Promise.all([first, second]);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.setDoc).toHaveBeenCalledTimes(1);
  });

  it("rend une erreur réseau au demandeur et permet de réessayer", async () => {
    permission = "granted";
    firestoreMocks.setDoc.mockRejectedValueOnce(new Error("network"));
    await expect(enablePushNotifications(parentUser)).rejects.toThrow("network");
    firestoreMocks.setDoc.mockResolvedValueOnce(undefined);
    await expect(enablePushNotifications(parentUser)).resolves.toMatchObject({ status: "enabled" });
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });
});

describe("désactivation des notifications Acadéa", () => {
  async function activateCurrentDevice() {
    permission = "granted";
    await enablePushNotifications(parentUser);
    messagingMocks.foregroundStop.mockClear();
    firestoreMocks.deleteDoc.mockClear();
    messagingMocks.deleteToken.mockClear();
  }

  it("supprime uniquement le document de l'appareil courant avant le token local", async () => {
    await activateCurrentDevice();
    const initialPermission = permission;
    await expect(disablePushNotifications(parentUser)).resolves.toEqual({ status: "disabled", deviceId: "device-new" });
    expect(firestoreMocks.doc).toHaveBeenLastCalledWith(expect.anything(), "users", parentUser.id, "pushTokens", "device-new");
    expect(firestoreMocks.deleteDoc).toHaveBeenCalledTimes(1);
    expect(messagingMocks.deleteToken).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.deleteDoc.mock.invocationCallOrder[0]).toBeLessThan(messagingMocks.deleteToken.mock.invocationCallOrder[0]);
    expect(messagingMocks.foregroundStop).toHaveBeenCalledTimes(1);
    expect(permission).toBe(initialPermission);
  });

  it("n'invalide pas le token local lorsque Firestore échoue et conserve l'état actif", async () => {
    await activateCurrentDevice();
    firestoreMocks.deleteDoc.mockRejectedValueOnce(new Error("firestore"));
    await expect(disablePushNotifications(parentUser)).rejects.toThrow("firestore");
    expect(messagingMocks.deleteToken).not.toHaveBeenCalled();
    firestoreMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ active: true, token: "current-token" }) });
    await expect(getPushNotificationStatus(parentUser)).resolves.toBe("enabled");
  });

  it("traite l'absence d'identifiant local sans suppression globale", async () => {
    await expect(disablePushNotifications(parentUser)).resolves.toEqual({ status: "no-device" });
    expect(firestoreMocks.deleteDoc).not.toHaveBeenCalled();
    expect(messagingMocks.deleteToken).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur non autorisé sans supprimer de token", async () => {
    storage.set("acadea:push-device-id", "device-existing");
    await expect(disablePushNotifications({ ...parentUser, role: "cashier" })).resolves.toEqual({ status: "not-authorized" });
    expect(firestoreMocks.deleteDoc).not.toHaveBeenCalled();
    expect(messagingMocks.deleteToken).not.toHaveBeenCalled();
  });

  it("mutualise deux désactivations concurrentes", async () => {
    await activateCurrentDevice();
    let releaseDeletion!: () => void;
    firestoreMocks.deleteDoc.mockImplementation(() => new Promise<void>((resolve) => { releaseDeletion = resolve; }));
    const first = disablePushNotifications(parentUser);
    const second = disablePushNotifications(parentUser);
    await vi.waitFor(() => expect(firestoreMocks.deleteDoc).toHaveBeenCalledTimes(1));
    releaseDeletion();
    await Promise.all([first, second]);
    expect(firestoreMocks.deleteDoc).toHaveBeenCalledTimes(1);
    expect(messagingMocks.deleteToken).toHaveBeenCalledTimes(1);
  });

  it("empêche une désactivation pendant une activation", async () => {
    permission = "granted";
    let releaseToken!: (token: string) => void;
    messagingMocks.getToken.mockImplementation(() => new Promise<string>((resolve) => { releaseToken = resolve; }));
    const activation = enablePushNotifications(parentUser);
    await vi.waitFor(() => expect(messagingMocks.getToken).toHaveBeenCalledTimes(1));
    await expect(disablePushNotifications(parentUser)).resolves.toEqual({ status: "operation-in-progress" });
    expect(firestoreMocks.deleteDoc).not.toHaveBeenCalled();
    releaseToken("current-token");
    await activation;
  });

  it("permet une nouvelle activation après désactivation", async () => {
    await activateCurrentDevice();
    await disablePushNotifications(parentUser);
    requestPermission.mockClear();
    firestoreMocks.setDoc.mockClear();
    await expect(enablePushNotifications(parentUser)).resolves.toMatchObject({ status: "enabled" });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.setDoc).toHaveBeenCalledTimes(1);
  });
});

describe("service worker unique", () => {
  it("accepte uniquement les événements push autorisés dans l'unique service worker", () => {
    const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    expect(source).toContain('data.module === "payments" && data.event === "payment_recorded"');
    expect(source).toContain('data.event === "school_message_received" || data.event === "parent_message_received"');
    expect(source).toContain('data.event === "student_absent" || data.event === "student_late"');
    expect(source).toContain('data.event === "discipline_incident_created"');
    expect(source).toContain('data.event === "announcement_published"');
    expect(source).not.toContain("attendance_recorded");
    expect(source).not.toContain("discipline_recorded");
    expect(source.match(/addEventListener\("push"/g)).toHaveLength(1);
  });
});
