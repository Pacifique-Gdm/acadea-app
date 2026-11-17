import { OAuth2Client } from "google-auth-library";
import { FinancialApiError } from "./financialTransactions.js";

/** Lot 27a-bis : seules les tâches programmées Firebase du même projet peuvent lancer la maintenance de la
 * répartition. Elles présentent un jeton d'identité signé par Google (compte de service des fonctions),
 * vérifié ici : aucun mot de passe partagé à créer ni à stocker. */
export const MAINTENANCE_CALLERS = {
  "acadea-production": { email: "122814452005-compute@developer.gserviceaccount.com", audience: "https://acadea-app.vercel.app" },
  "acadea-staging": { email: "1039133094640-compute@developer.gserviceaccount.com", audience: "https://acadea-staging.vercel.app" },
};

export async function verifyMaintenanceCaller(token, projectId = process.env.VITE_FIREBASE_PROJECT_ID, client = new OAuth2Client()) {
  const expected = MAINTENANCE_CALLERS[projectId];
  if (!expected || !token) throw new FinancialApiError(401, "unauthenticated", "Tâche de maintenance non reconnue.");
  let payload;
  try { payload = (await client.verifyIdToken({ idToken: token, audience: expected.audience })).getPayload(); }
  catch { throw new FinancialApiError(401, "unauthenticated", "Jeton de maintenance invalide."); }
  if (!payload?.email_verified || payload.email !== expected.email) throw new FinancialApiError(403, "permission-denied", "Tâche de maintenance non autorisée.");
  return { uid: payload.email, role: "maintenance" };
}
