import { useEffect } from "react";
import type { OfflineAccess } from "../../services/offlineAccess";
import { OfflineQueuePanel } from "../offline/OfflineQueuePanel";

const roleLabels: Record<OfflineAccess["role"], string> = {
  teacher: "Enseignant", discipline_director: "Directeur de Discipline", school_admin: "Administrateur", secretary: "Secrétaire", cashier: "Caissier",
};

export function OfflineAccessScreen({ access, onLogout }: {
  access: OfflineAccess;
  onLogout: () => void;
}) {
  const onReconnect = () => { if (navigator.onLine !== false) window.location.reload(); };
  useEffect(() => {
    const reconnect = () => window.location.reload();
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, []);
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-4 py-10 text-ink">
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
      <h1 className="text-xl font-bold">Acadéa hors connexion</h1>
      <p className="mt-2 text-sm">Session locale limitée · {roleLabels[access.role]} · {access.schoolName}</p>
      <p className="mt-1 text-sm">Année scolaire : {access.schoolYearName}</p>
      <p className="mt-4 text-sm font-semibold">Aucune écriture n'est confirmée par Acadéa tant que le serveur n'a pas revérifié votre identité et vos droits.</p>
      <p className="mt-2 text-sm">Cet accès local expire le {new Date(access.expiresAt).toLocaleString("fr-FR")}.
        Les données non préchargées restent indisponibles.</p>
    </div>
    <OfflineQueuePanel scope={{ userId: access.userId, schoolId: access.schoolId, schoolYearId: access.schoolYearId }} role={access.role} autoSync={false} />
    <button type="button" className="primary-button justify-center" onClick={onReconnect}>Réessayer la connexion sécurisée</button>
    <button type="button" className="secondary-button justify-center" onClick={onLogout}>Se déconnecter de cet appareil</button>
  </main>;
}
