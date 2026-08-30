import { useState } from "react";
import { LogOut, Plus } from "lucide-react";
import { EnvironmentBanner } from "../layout/EnvironmentBanner";
import type { AppUser, SchoolYear } from "../../types";

export function YearScreen({
  user,
  years,
  activeYearId,
  onSelect,
  onLogout,
  onCreate,
  createId,
  governance,
}: {
  user: AppUser;
  years: SchoolYear[];
  activeYearId: string;
  onSelect: (id: string) => void;
  onLogout: () => void;
  onCreate: (year: SchoolYear) => void;
  createId: (prefix: string) => string;
  governance?: { closed: boolean; loading: boolean; error: string };
}) {
  const [name, setName] = useState("2026-2027");
  const canEdit = user.role === "school_admin" && !governance?.closed && !governance?.loading && !governance?.error;

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4">
      <EnvironmentBanner />
      <section className="mx-auto max-w-4xl py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-mint">Acadéa</p>
            <h1 className="text-3xl font-bold text-ink">Sélection de l'année scolaire</h1>
          </div>
          <button onClick={onLogout} className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
            <LogOut className="h-4 w-4" /> Déconnexion
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {years.map((year) => (
            <button key={year.id} onClick={() => onSelect(year.id)} className="rounded border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-mint">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-ink">{year.name}</h2>
                {year.id === activeYearId && <span className="rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">Active</span>}
              </div>
              <p className="mt-2 text-sm text-slate-500">{year.startsAt} au {year.endsAt}</p>
              <p className="mt-4 text-sm font-medium capitalize text-slate-700">{year.status}</p>
            </button>
          ))}
        </div>
        {governance?.loading && <p role="status" className="mt-5 rounded border border-slate-200 bg-white p-4">Vérification de la gouvernance des années scolaires…</p>}
        {governance?.error && <p role="alert" className="mt-5 rounded border border-red-200 bg-red-50 p-4 text-red-800">{governance.error}</p>}
        {governance?.closed && <p role="status" className="mt-5 rounded border border-blue-200 bg-blue-50 p-4 text-blue-800">Les années scolaires ont été clôturées par la Coordination. Veuillez demander au Coordinateur de créer une nouvelle année scolaire.</p>}
        {canEdit && (
          <div className="mt-5 flex flex-col gap-2 rounded border border-slate-200 bg-white p-4 sm:flex-row">
            <input value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded border border-slate-200 px-3 py-2" />
            <button
              onClick={() =>
                onCreate({
                  id: createId("year"),
                  schoolId: user.schoolId ?? "",
                  name,
                  startsAt: `${name.slice(0, 4)}-09-01`,
                  endsAt: `${name.slice(5)}-07-15`,
                  status: "draft",
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded bg-ink px-4 py-2 font-semibold text-white"
            >
              <Plus className="h-4 w-4" /> Créer
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
