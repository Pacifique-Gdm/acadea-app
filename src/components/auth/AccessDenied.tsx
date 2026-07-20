import { LogOut, ShieldCheck } from "lucide-react";
import { EnvironmentBanner } from "../layout/EnvironmentBanner";

export function AccessDenied({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f8fb] p-4">
      <EnvironmentBanner />
      <section className="w-full max-w-md rounded border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-red-600" />
        <h1 className="text-2xl font-bold text-ink">Accès refusé</h1>
        <p className="mt-2 text-sm text-slate-500">Votre rôle ou votre école ne permet pas d'ouvrir cet espace.</p>
        <button onClick={onLogout} className="primary-button mt-5">
          <LogOut className="h-4 w-4" /> Retour à la connexion
        </button>
      </section>
    </main>
  );
}
