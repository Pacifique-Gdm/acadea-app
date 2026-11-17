import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { GoogleAuth } from "google-auth-library";

/** Lot 27a-bis — tâches programmées de la répartition des frais (décision du propriétaire, 17/11/2026).
 * Économes : chaque passage commence par UNE lecture ; le serveur Acadéa n'est appelé que s'il y a du travail.
 * Appel authentifié par le jeton d'identité Google du compte de service des fonctions (aucun mot de passe). */
const TARGETS: Record<string, string> = {
  "acadea-production": "https://acadea-app.vercel.app",
  "acadea-staging": "https://acadea-staging.vercel.app",
};

export async function callMaintenance(action: "fee-allocation-maintenance" | "fee-allocation-nightly-check") {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
  const target = TARGETS[project];
  if (!target) { logger.warn("Projet sans serveur Acadéa connu : maintenance ignorée.", { project }); return null; }
  const client = await new GoogleAuth().getIdTokenClient(target);
  const response = await client.request({ url: `${target}/api/manage-financial-transaction`, method: "POST",
    headers: { "Content-Type": "application/json", "X-Acadea-Maintenance": "1" }, data: { action }, timeout: 50_000 });
  logger.info("Maintenance de la répartition terminée.", { action, result: response.data });
  return response.data;
}

/** Toutes les 10 minutes : reprend les paiements en attente de répartition et alerte après une heure. */
export const allocationMaintenanceEvery10Minutes = onSchedule({ schedule: "every 10 minutes", region: "europe-west1", timeZone: "Africa/Kinshasa", retryCount: 1 }, async () => {
  const pending = await getFirestore().collection("feeAllocationPending").where("status", "==", "pending").limit(1).get();
  if (pending.empty) return; // une seule lecture quand tout est réparti
  await callMaintenance("fee-allocation-maintenance");
});

/** Chaque nuit à 2 h 30 (Kinshasa) : tout l'encaissé doit être réparti, au centime près. */
export const allocationNightlyCheck = onSchedule({ schedule: "every day 02:30", region: "europe-west1", timeZone: "Africa/Kinshasa", retryCount: 1 }, async () => {
  const active = await getFirestore().collection("feeAllocationStates").where("status", "in", ["ACTIVE", "PAUSED"]).limit(1).get();
  if (active.empty) return; // aucune école avec répartition active
  await callMaintenance("fee-allocation-nightly-check");
});
