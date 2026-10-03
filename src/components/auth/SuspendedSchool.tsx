import { PlatformLogoSlot } from "../layout/PlatformLogoSlot";

export const SUSPENDED_SCHOOL_MESSAGE = "CETTE ÉCOLE A ÉTÉ SUSPENDUE, VEUILLEZ CONTACTER L'ÉQUIPE ACADÉA. MERCI";

export function SuspendedSchool({ logoUrl, onLogout }: { logoUrl: string; onLogout: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-[#F5F7FB] px-4 py-8 text-center text-ink">
    <section className="w-full max-w-xl rounded-xl border border-amber-200 bg-white p-6 shadow-sm sm:p-10">
      <PlatformLogoSlot logoUrl={logoUrl} compact />
      <h1 className="mt-4 break-words text-lg font-bold leading-relaxed sm:text-xl">{SUSPENDED_SCHOOL_MESSAGE}</h1>
      <button type="button" className="secondary-button mt-6 justify-center" onClick={onLogout}>Déconnexion</button>
    </section>
  </main>;
}
