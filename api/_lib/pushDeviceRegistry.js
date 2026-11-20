// P4, lot 4 (correction 3, partie serveur) : un navigateur n'appartient qu'au DERNIER compte qui y a activé
// les notifications. Le jeton FCM est propre au navigateur (le même pour tous les comptes de l'appareil) :
// sans ce registre, l'ancien compte A continuait de recevoir ses notifications sur le téléphone de B.
//
// Registre : pushDevices/<sha256(jeton)> = { userId, deviceId, updatedAt } (fermé aux navigateurs par la règle
// générale « tout refusé » ; seul le serveur l'écrit). Quand un autre compte présente le MÊME jeton, on supprime
// chez l'ancien compte les seuls documents pushTokens qui portent EXACTEMENT ce jeton : ses autres appareils
// (jetons différents) ne sont jamais touchés, et on ne peut détacher qu'un jeton qu'on possède soi-même.
import { createHash } from "node:crypto";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_TOKEN_LENGTH = 4096;

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: "invalid-argument" });
}

export function pushDeviceRegistryId(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function parsePushDeviceInput(body) {
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw badRequest("Identifiant d'appareil invalide.");
  if (!token || token.length > MAX_TOKEN_LENGTH) throw badRequest("Jeton de notifications invalide.");
  return { deviceId, token };
}

/**
 * Inscrit `caller.uid` comme seul compte de ce jeton et détache l'ancien compte s'il y en a un.
 * Le document users/<uid>/pushTokens/<deviceId> doit déjà exister avec ce jeton (écrit par l'appareil juste avant) :
 * cela prouve que l'appelant possède réellement ce jeton.
 */
export async function registerPushDevice(db, caller, body, now = new Date()) {
  const { deviceId, token } = parsePushDeviceInput(body);
  const uid = String(caller?.uid ?? "");
  if (!uid) throw Object.assign(new Error("Authentification requise."), { statusCode: 401, code: "not-authenticated" });
  const ownReference = db.doc(`users/${uid}/pushTokens/${deviceId}`);
  const registryReference = db.doc(`pushDevices/${pushDeviceRegistryId(token)}`);

  return db.runTransaction(async (transaction) => {
    const own = await transaction.get(ownReference);
    if (!own.exists || own.data()?.token !== token || own.data()?.userId !== uid) {
      throw Object.assign(new Error("Jeton de notifications non enregistré pour ce compte."), { statusCode: 409, code: "failed-precondition" });
    }
    const registry = await transaction.get(registryReference);
    const previousUserId = registry.exists ? String(registry.data()?.userId ?? "") : "";
    let detached = 0;
    if (previousUserId && previousUserId !== uid) {
      const stale = await transaction.get(db.collection(`users/${previousUserId}/pushTokens`).where("token", "==", token));
      for (const document of stale.docs) {
        if (document.data()?.token !== token) continue;
        transaction.delete(document.ref);
        detached += 1;
      }
    }
    transaction.set(registryReference, { userId: uid, deviceId, updatedAt: now.toISOString() });
    return { registered: true, detached };
  });
}
