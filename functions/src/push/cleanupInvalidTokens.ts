import type { Firestore } from "firebase-admin/firestore";

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

export function isInvalidTokenError(code?: string) {
  return Boolean(code && INVALID_TOKEN_CODES.has(code));
}

export async function deactivateInvalidToken(database: Firestore, userId: string, tokenId: string) {
  await database.doc(`users/${userId}/pushTokens/${tokenId}`).delete();
}
