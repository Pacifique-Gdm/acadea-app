import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

/** P4, lot 1 : texte de l'avertissement (les brouillons ne sont jamais supprimés par la déconnexion). */
export function logoutDraftsMessage(count: number) {
  const plural = count > 1;
  return `Vous avez ${count} brouillon${plural ? "s" : ""} non envoyé${plural ? "s" : ""} sur cet appareil. `
    + `${plural ? "Ils resteront" : "Il restera"} ici, réservé${plural ? "s" : ""} à votre compte, et ${plural ? "seront envoyés" : "sera envoyé"} à votre prochaine connexion.`;
}

export function LogoutDraftsDialog({ count, onStay, onLogout }: { count: number; onStay: () => void; onLogout: () => void }) {
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stayRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onStay(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStay]);
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="logout-drafts-title" aria-describedby="logout-drafts-text"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="logout-drafts-title" className="text-lg font-bold text-slate-900">Brouillons non envoyés</h2>
        <p id="logout-drafts-text" className="mt-3 text-justify text-sm text-slate-700">{logoutDraftsMessage(count)}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button ref={stayRef} type="button" onClick={onStay} className="rounded border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50">Rester connecté</button>
          <button type="button" onClick={onLogout} className="rounded border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100">Me déconnecter quand même</button>
        </div>
      </div>
    </div>
  );
}

/** Ouvre l'avertissement au-dessus de tout écran ; `true` = se déconnecter, `false` = rester connecté. */
export function confirmLogoutWithDrafts(count: number): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(true);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (answer: boolean) => { root.unmount(); host.remove(); resolve(answer); };
    root.render(<LogoutDraftsDialog count={count} onStay={() => close(false)} onLogout={() => close(true)} />);
  });
}
