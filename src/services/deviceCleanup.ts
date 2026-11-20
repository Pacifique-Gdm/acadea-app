// P4, lot 2 : UNE seule fonction de nettoyage de l'appareil, appelée à chaque fin de session.
// Après elle, rien du compte précédent ne reste sur l'appareil, SAUF ses brouillons non envoyés
// (ils restent chiffrés, réservés à son compte, et partent à sa prochaine connexion).
import { clearPersistentMemo } from "../hooks/usePersistentMemo";
import { clearDashboardArrearsCache } from "./dashboardArrearsCache";
import { clearExpenseCurrencyCache } from "./expenseCurrencyCache";
import { clearHistoricalArrearsCache } from "./historicalArrearsCache";
import { deleteOfflineContexts, deleteOldConfirmedOperations } from "./offlineQueue";
import { clearStudentPhotoUrls } from "./studentPhotoStorage";

export type DeviceCleanupReport = { memory: boolean; expenseCurrencies: boolean; offlineContexts: number; sessionStorage: boolean; notifications: number };

/** Ferme les notifications d'Acadéa encore affichées sur l'appareil (le compte suivant ne doit pas les lire). */
export async function closeDisplayedNotifications(): Promise<number> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.getRegistration) return 0;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.getNotifications) return 0;
  const shown = await registration.getNotifications();
  shown.forEach((notification) => notification.close());
  return shown.length;
}

export async function cleanDeviceAfterSession(): Promise<DeviceCleanupReport> {
  const report: DeviceCleanupReport = { memory: false, expenseCurrencies: false, offlineContexts: 0, sessionStorage: false, notifications: 0 };
  // Mémoire de l'onglet (calculs, arriérés, photos lues avec l'identité du compte).
  clearPersistentMemo(); clearDashboardArrearsCache(); clearHistoricalArrearsCache(); clearStudentPhotoUrls();
  report.memory = true;
  // Devises des dépenses : mémoire + stockage du navigateur.
  clearExpenseCurrencyCache(true); report.expenseCurrencies = true;
  // Copies de référence hors ligne (le billet hors ligne est déjà effacé : elles ne servent plus).
  report.offlineContexts = await deleteOfflineContexts().catch(() => 0);
  // Stockage de l'onglet (version d'horaire, filtres) : propre à Acadéa, vidé entièrement.
  try { globalThis.sessionStorage?.clear(); report.sessionStorage = true; } catch { /* stockage indisponible */ }
  report.notifications = await closeDisplayedNotifications().catch(() => 0);
  return report;
}

/**
 * P4, lot 2 (correction 6), à l'ouverture d'Acadéa : copies de référence périmées (plus de 8 h) supprimées,
 * et opérations confirmées par le serveur depuis plus de 30 jours retirées. Aucun brouillon non envoyé n'est touché.
 */
export async function purgeExpiredOfflineData(now = Date.now()) {
  const contexts = await deleteOfflineContexts({ onlyExpired: true, now }).catch(() => 0);
  const confirmed = await deleteOldConfirmedOperations(now).catch(() => 0);
  return { contexts, confirmed };
}

/**
 * Après une déconnexion EN LIGNE, la page est rechargée sur /login : cela vide aussi toutes les mémoires
 * qu'aucune fonction ne peut vider (dont celle de Firestore, qui garde les documents du compte précédent :
 * vérifié sur l'émulateur). Hors ligne, on ne recharge pas (la page pourrait ne pas revenir).
 */
export function shouldReloadAfterLogout(online: boolean | undefined) {
  return online !== false;
}
