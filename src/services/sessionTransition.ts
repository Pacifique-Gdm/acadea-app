// P4, lot 3 (corrections 4 et 5 de l'étude) : que faire quand la session change SANS appui sur « Déconnexion ».
// - Déconnexion automatique (session expirée, compte désactivé, profil introuvable) : nettoyage central,
//   mais SEULEMENT en ligne. Hors ligne, « pas d'utilisateur » est l'état normal de la reprise hors ligne.
// - Changement de compte dans un autre onglet : l'écran repart de zéro et les caches du compte précédent sont vidés.
// Les brouillons non envoyés ne sont jamais touchés (cleanDeviceAfterSession ne les supprime pas).
import { cleanDeviceAfterSession } from "./deviceCleanup";
import { clearOfflineAccess, readOfflineAccessForCurrentDevice } from "./offlineAccess";

export type AuthTransition = "first-sign-in" | "same-account" | "account-switch" | "signed-out";

/** Classe le passage d'un compte à l'autre. Le même identifiant (simple mise à jour du profil) ne vide rien. */
export function classifyAuthTransition(previousUserId: string, nextUserId: string | null | undefined): AuthTransition {
  if (!nextUserId) return "signed-out";
  if (!previousUserId) return "first-sign-in";
  return previousUserId === nextUserId ? "same-account" : "account-switch";
}

export type SignedOutCleanup = "none" | "clean" | "clean-if-leftover";

/**
 * Firebase répond « plus d'utilisateur » :
 * - pendant une déconnexion manuelle : rien ici (logout() fait déjà le nettoyage puis recharge la page) ;
 * - hors ligne (ou état du réseau inconnu) : rien, pour que la reprise hors ligne continue de marcher ;
 * - en ligne après une session ouverte dans cet onglet : nettoyage complet ;
 * - en ligne à l'ouverture d'Acadéa : nettoyage seulement s'il reste un billet hors ligne d'une session mal fermée.
 */
export function decideSignedOutCleanup(input: { previousUserId: string; online: boolean | undefined; logoutInProgress: boolean }): SignedOutCleanup {
  if (input.logoutInProgress) return "none";
  if (input.online !== true) return "none";
  return input.previousUserId ? "clean" : "clean-if-leftover";
}

// Erreurs qui prouvent que la session n'est plus valable (et non un simple souci de réseau).
const DEFINITIVE_SESSION_ERROR_CODES = new Set([
  "permission-denied",
  "unauthenticated",
  "auth/user-disabled",
  "auth/user-token-expired",
  "auth/invalid-user-token",
  "auth/user-not-found",
]);

/**
 * Erreur de session (compte désactivé, profil introuvable ou incomplet, droits retirés) :
 * nettoyage seulement en ligne ET si l'erreur est définitive. Une erreur de réseau ou la minuterie
 * « La préparation de votre session a expiré » ne touchent à rien (la reprise hors ligne doit rester possible).
 */
export function decideSessionErrorCleanup(input: { error: unknown; online: boolean | undefined; logoutInProgress: boolean }): SignedOutCleanup {
  if (input.logoutInProgress || input.online !== true) return "none";
  const code = typeof (input.error as { code?: unknown } | null)?.code === "string" ? String((input.error as { code: string }).code) : "";
  if (code) return DEFINITIVE_SESSION_ERROR_CODES.has(code) ? "clean" : "none";
  // Erreurs sans code levées par Acadéa lui-même après lecture du profil (refus explicites).
  const message = input.error instanceof Error ? input.error.message : "";
  if (!message || message.includes("session a expiré")) return "none";
  return "clean";
}

type CleanupDeps = {
  clearAccess: () => Promise<void>;
  cleanDevice: () => Promise<unknown>;
  readLeftoverAccess: () => Promise<unknown>;
};

const defaultDeps: CleanupDeps = {
  clearAccess: clearOfflineAccess,
  cleanDevice: cleanDeviceAfterSession,
  readLeftoverAccess: readOfflineAccessForCurrentDevice,
};

// File d'attente unique : la préparation hors ligne du compte suivant (billet, copie de référence)
// attend la fin du nettoyage du compte précédent, sinon le nettoyage pourrait effacer ce qu'elle vient d'écrire.
let pendingCleanup: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<unknown>): Promise<void> {
  const next = pendingCleanup.then(task).then(() => undefined, () => undefined);
  pendingCleanup = next;
  return next;
}

/** Lance `task` seulement après le nettoyage de session en cours (s'il y en a un). */
export function afterSessionCleanup<T>(task: () => Promise<T>): Promise<T> {
  return pendingCleanup.then(task);
}

/** Nettoyage après une fin de session automatique. Retourne vrai si l'appareil a été nettoyé. */
export function cleanAfterSignedOut(decision: SignedOutCleanup, deps: CleanupDeps = defaultDeps): Promise<boolean> {
  if (decision === "none") return Promise.resolve(false);
  let cleaned = false;
  return enqueue(async () => {
    if (decision === "clean-if-leftover" && !(await deps.readLeftoverAccess().catch(() => null))) return;
    await deps.clearAccess().catch(() => undefined);
    await deps.cleanDevice().catch(() => undefined);
    cleaned = true;
  }).then(() => cleaned);
}

/**
 * Changement de compte dans un autre onglet : le billet hors ligne du compte précédent n'a plus lieu d'être
 * (la session Firebase partagée est maintenant celle du nouveau compte), et tous les caches sont vidés.
 */
export function cleanAfterAccountSwitch(deps: Pick<CleanupDeps, "clearAccess" | "cleanDevice"> = defaultDeps): Promise<void> {
  return enqueue(async () => {
    await deps.clearAccess().catch(() => undefined);
    await deps.cleanDevice().catch(() => undefined);
  });
}

/** Pour les tests seulement. */
export function resetSessionCleanupQueueForTests() { pendingCleanup = Promise.resolve(); }
