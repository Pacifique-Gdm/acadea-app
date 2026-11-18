// Un compte de connexion ne peut jamais être créé deux fois pour la même adresse e-mail, même si deux demandes
// arrivent au même moment (double clic, deux appareils). Un verrou court par adresse est pris dans une transaction
// AVANT la création ; la seconde demande est refusée avec un message clair. Le verrou est retiré ensuite : la
// vérification auprès de Firebase (même adresse déjà utilisée) prend le relais.
import { createHash, randomUUID } from "node:crypto";

export const ACCOUNT_EMAIL_LOCK_MS = 2 * 60 * 1000;
const lockRef = (db, email) => db.doc(`accountEmailLocks/${createHash("sha256").update(String(email ?? "").trim().toLowerCase()).digest("hex")}`);
const taken = (message) => Object.assign(new Error(message), { statusCode: 409, status: 409, code: "already-exists" });

export async function createAuthUserOnce(auth, db, params, { now = () => Date.now() } = {}) {
  const ref = lockRef(db, params.email), token = randomUUID();
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data();
    if (current && now() - Date.parse(current.createdAt) < ACCOUNT_EMAIL_LOCK_MS) {
      throw taken("Une création de compte avec cette adresse e-mail est déjà en cours. Patientez quelques instants puis actualisez.");
    }
    transaction.set(ref, { token, createdAt: new Date(now()).toISOString() });
  });
  const release = () => db.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data();
    if (current?.token === token) transaction.delete(ref);
  }).catch(() => undefined);
  try {
    if (typeof auth.getUserByEmail === "function") {
      const existing = await auth.getUserByEmail(params.email).catch((error) => {
        if (error?.code === "auth/user-not-found") return null;
        throw error;
      });
      if (existing) throw taken("Un compte utilise déjà cette adresse e-mail.");
    }
    return await auth.createUser(params);
  } finally {
    await release();
  }
}
