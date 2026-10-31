const requestIdPattern = /^[a-f0-9]{32}$/;

export function provisioningRequestId(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !requestIdPattern.test(value)) {
    throw Object.assign(new Error("Identifiant de demande invalide."), { statusCode: 400, code: "invalid-argument" });
  }
  return value;
}

export async function findProvisioningReceipt(db, requestId, actorId, kind, identity) {
  if (!requestId) return null;
  const snapshot = await db.doc(`provisioningReceipts/${requestId}`).get();
  if (!snapshot.exists) return null;
  const receipt = snapshot.data();
  if (receipt?.actorId !== actorId || receipt?.kind !== kind || receipt?.identity !== identity) {
    throw Object.assign(new Error("Cette demande de création ne correspond pas à l'opération initiale."), { statusCode: 409, code: "request-conflict" });
  }
  return receipt.result;
}

export function provisioningReceipt(requestId, actorId, kind, identity, schoolId, result) {
  return { id: requestId, actorId, kind, identity, schoolId, result, createdAt: new Date().toISOString() };
}
