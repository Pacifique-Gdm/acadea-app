// Un compte de connexion ne peut jamais être créé deux fois pour la même adresse e-mail, même si deux demandes
// arrivent au même moment (double clic, deux appareils). Un verrou court par adresse est posé AVANT la création,
// par une création atomique (« create » échoue si le verrou existe déjà) ; la seconde demande est refusée avec un
// message clair. Le verrou est retiré ensuite : la vérification auprès de Firebase (adresse déjà utilisée) prend le relais.
import { createHash, randomUUID } from "node:crypto";

export const ACCOUNT_EMAIL_LOCK_MS = 2 * 60 * 1000;
const lockRef = (db, email) => db.doc(`accountEmailLocks/${createHash("sha256").update(String(email ?? "").trim().toLowerCase()).digest("hex")}`);
// Même code que Firebase (« adresse déjà utilisée ») : les messages et la gestion des erreurs existants restent valables.
const taken = (message) => Object.assign(new Error(message), { statusCode: 409, status: 409, code: "auth/email-already-exists" });
const IN_PROGRESS = "Une création de compte avec cette adresse e-mail est déjà en cours. Patientez quelques instants puis actualisez.";
const lockExists = (error) => error?.code === 6 || error?.code === "already-exists" || /already exists/i.test(String(error?.message ?? ""));

async function acquire(ref, token, now) {
  const lock = () => ref.create({ token, createdAt: new Date(now()).toISOString() });
  try { await lock(); return; } catch (error) { if (!lockExists(error)) throw error; }
  const snapshot = await ref.get();
  const current = snapshot?.exists === false ? undefined : snapshot?.data?.();
  if (current && now() - Date.parse(current.createdAt) < ACCOUNT_EMAIL_LOCK_MS) throw taken(IN_PROGRESS);
  // Verrou oublié (demande interrompue il y a plus de 2 minutes) : il est remplacé une seule fois.
  await ref.delete();
  try { await lock(); } catch (error) { if (lockExists(error)) throw taken(IN_PROGRESS); throw error; }
}

async function release(ref, token) {
  try {
    const snapshot = await ref.get();
    if (snapshot?.data?.()?.token === token) await ref.delete();
  } catch { /* le verrou expire seul au bout de 2 minutes */ }
}

export async function createAuthUserOnce(auth, db, params, { now = () => Date.now() } = {}) {
  const ref = lockRef(db, params.email), token = randomUUID();
  await acquire(ref, token, now);
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
    await release(ref, token);
  }
}
