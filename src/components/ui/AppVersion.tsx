/** Petit lot « Version » : numéro de l'application, en petit et discret, sous « Déconnexion ».
 * Règle : dernier chiffre = correction, chiffre du milieu = nouvelle fonctionnalité, premier chiffre = grand changement. */
export const appVersion = typeof __ACADEA_APP_VERSION__ === "string" ? __ACADEA_APP_VERSION__ : "inconnue";

export function AppVersion() {
  return <p className="mt-1 text-center text-xs text-slate-400" aria-label="Version de l'application">Version {appVersion}</p>;
}
