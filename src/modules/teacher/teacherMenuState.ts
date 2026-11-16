/** Lot 26b : état des boutons du Menu Enseignant qui ont besoin du profil pédagogique de l'année
 * (Fiche de cotation, Mes élèves, Mes demandes). Le Menu lui-même (Salaire/Prime, Bibliothèque,
 * Historique, Année scolaire, Notifications, Déconnexion) reste toujours affiché. */
export function teacherMenuProfileState(data: { loading: boolean; error: string; teacher?: unknown }) {
  if (data.teacher) return { ready: true, message: "" };
  if (data.loading) return { ready: false, message: "Chargement de votre profil pédagogique…" };
  return { ready: false, message: data.error || "Aucun profil pédagogique n'est lié à votre compte pour cette année. Contactez la Direction des études." };
}
