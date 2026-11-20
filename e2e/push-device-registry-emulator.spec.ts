import { expect, test } from "@playwright/test";
import handler from "../api/message-recipients.js";
import { pushDeviceRegistryId } from "../api/_lib/pushDeviceRegistry.js";
import { fixture, invoke } from "./support/emulatorRecipe";

// P4, lot 4 : deux comptes sur le même navigateur (donc le même jeton FCM). Quand le compte B active ses
// notifications, le document du compte A qui porte ce jeton disparaît ; celui d'un autre appareil de A reste.
test("Notifications : le jeton partagé est détaché de l'ancien compte, ses autres appareils restent", async () => {
  test.setTimeout(120_000);
  const f = fixture();
  const sharedToken = `${f.tag}-jeton-navigateur-partage`;
  const otherDeviceToken = `${f.tag}-jeton-ordinateur-du-caissier`;
  const created: string[] = [];
  const writeToken = async (uid: string, deviceId: string, token: string) => {
    const path = `users/${uid}/pushTokens/${deviceId}`;
    created.push(path);
    const now = new Date().toISOString();
    await f.db.doc(path).set({ userId: uid, deviceId, token, platform: "web", active: true, createdAt: now, updatedAt: now });
  };
  try {
    await f.seed(["cashier", "teacher"]);
    const a = f.accounts.cashier.uid, b = f.accounts.teacher.uid;
    const sharedDevice = `${f.tag}-telephone-partage`, otherDevice = `${f.tag}-ordinateur-caissier`;
    created.push(`pushDevices/${pushDeviceRegistryId(sharedToken)}`, `pushDevices/${pushDeviceRegistryId(otherDeviceToken)}`);

    // Le caissier (A) active ses notifications sur le téléphone partagé et sur son ordinateur.
    await writeToken(a, sharedDevice, sharedToken);
    await writeToken(a, otherDevice, otherDeviceToken);
    const tokenA = await f.token("cashier");
    expect((await invoke(handler, tokenA, { action: "register-push-device", deviceId: sharedDevice, token: sharedToken })).payload).toEqual({ registered: true, detached: 0 });
    expect((await invoke(handler, tokenA, { action: "register-push-device", deviceId: otherDevice, token: otherDeviceToken })).payload).toEqual({ registered: true, detached: 0 });

    // B ne peut pas détacher un jeton qu'il n'a pas lui-même enregistré.
    const tokenB = await f.token("teacher");
    const refused = await invoke(handler, tokenB, { action: "register-push-device", deviceId: sharedDevice, token: sharedToken });
    expect(refused.status).toBe(409);
    expect((await f.db.doc(`users/${a}/pushTokens/${sharedDevice}`).get()).exists).toBe(true);

    // L'enseignant (B) se connecte ensuite sur le même téléphone et active ses notifications : même jeton.
    await writeToken(b, sharedDevice, sharedToken);
    const switched = await invoke(handler, tokenB, { action: "register-push-device", deviceId: sharedDevice, token: sharedToken });
    expect(switched).toEqual({ status: 200, payload: { registered: true, detached: 1 } });

    expect((await f.db.doc(`users/${a}/pushTokens/${sharedDevice}`).get()).exists).toBe(false);
    expect((await f.db.doc(`users/${a}/pushTokens/${otherDevice}`).get()).data()).toMatchObject({ token: otherDeviceToken, active: true });
    expect((await f.db.doc(`users/${b}/pushTokens/${sharedDevice}`).get()).data()).toMatchObject({ token: sharedToken, active: true });
    expect((await f.db.doc(`pushDevices/${pushDeviceRegistryId(sharedToken)}`).get()).data()).toMatchObject({ userId: b, deviceId: sharedDevice });

    // Valeurs invalides refusées.
    expect((await invoke(handler, tokenB, { action: "register-push-device", deviceId: "../x", token: sharedToken })).status).toBe(400);
  } finally {
    for (const path of created) await f.db.doc(path).delete().catch(() => undefined);
    await f.cleanup();
  }
});
