import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Mail, Phone, Search, UserRound, UsersRound } from "lucide-react";
import type { ParentProfile, School, SchoolYear, Student } from "../../types";
import {
  buildParentsDirectory,
  buildParentsDirectoryClassChoices,
  fallbackText,
  filterParentsDirectory,
} from "../../utils/parentsDirectory";
import { printParentsDirectoryPdf } from "../../utils/parentsDirectoryPdf";

type ParentsDirectoryDrawerProps = {
  parents: ParentProfile[];
  students: Student[];
  school: School;
  year: SchoolYear;
  schoolId: string;
  schoolYearId: string;
};

export function ParentsDirectoryDrawer({ parents, students, school, year, schoolId, schoolYearId }: ParentsDirectoryDrawerProps) {
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [selectedParentId, setSelectedParentId] = useState("");
  const [listScrollTop, setListScrollTop] = useState(0);
  const [printError, setPrintError] = useState("");
  const [printing, setPrinting] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(
    () => buildParentsDirectory(parents, students, { schoolId, schoolYearId }),
    [parents, schoolId, schoolYearId, students],
  );
  const classChoices = useMemo(() => buildParentsDirectoryClassChoices(entries), [entries]);
  const filteredEntries = useMemo(() => filterParentsDirectory(entries, query, classFilter), [classFilter, entries, query]);
  const selectedEntry = entries.find((entry) => entry.parent.id === selectedParentId);

  useEffect(() => {
    if (selectedParentId) return;
    window.requestAnimationFrame(() => {
      if (listScrollRef.current) listScrollRef.current.scrollTop = listScrollTop;
    });
  }, [listScrollTop, selectedParentId]);

  function openParent(parentId: string) {
    setListScrollTop(listScrollRef.current?.scrollTop ?? 0);
    setSelectedParentId(parentId);
  }

  async function printDirectory() {
    setPrintError("");
    if (filteredEntries.length === 0) {
      setPrintError("Aucun parent ou tuteur à imprimer pour les filtres actuels.");
      return;
    }
    setPrinting(true);
    try {
      await printParentsDirectoryPdf({
        school,
        year,
        entries: filteredEntries,
        classFilterLabel: classFilter || undefined,
      });
    } catch (error) {
      console.warn("Impression de l'annuaire Parents / Tuteurs impossible.", error);
      setPrintError("Impossible de générer le PDF. Veuillez réessayer.");
    } finally {
      setPrinting(false);
    }
  }

  if (selectedEntry) {
    return (
      <div className="grid min-w-0 gap-4">
        <button onClick={() => setSelectedParentId("")} type="button" className="secondary-button w-fit">
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>

        <section className="grid min-w-0 gap-4 rounded border border-slate-200 bg-white p-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-lg font-bold text-ink">{fallbackText(selectedEntry.parent.fullName)}</p>
              <p className="mt-1 text-sm text-slate-500">{selectedEntry.children.length} enfant(s) lié(s)</p>
            </div>
            <span className="w-fit rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
              {selectedEntry.parent.status === "active" ? "Compte actif" : "Compte inactif"}
            </span>
          </div>

          <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded bg-slate-50 p-3">
              <dt className="text-xs font-semibold uppercase text-slate-500">Téléphone</dt>
              <dd className="mt-1 break-words font-semibold text-ink">{fallbackText(selectedEntry.parent.phone)}</dd>
            </div>
            <div className="min-w-0 rounded bg-slate-50 p-3">
              <dt className="text-xs font-semibold uppercase text-slate-500">Adresse e-mail de connexion</dt>
              <dd className="mt-1 break-words font-semibold text-ink">{fallbackText(selectedEntry.parent.email)}</dd>
            </div>
            <div className="min-w-0 rounded bg-slate-50 p-3 sm:col-span-2">
              <dt className="text-xs font-semibold uppercase text-slate-500">Adresse physique</dt>
              <dd className="mt-1 break-words font-semibold text-ink">{fallbackText(selectedEntry.parent.address)}</dd>
            </div>
          </dl>
        </section>

        <section className="grid min-w-0 gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <UsersRound className="h-5 w-5 text-slate-500" />
            <h3 className="font-bold text-ink">Enfants liés</h3>
          </div>
          {selectedEntry.children.length === 0 && (
            <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
              Aucun enfant lié dans cette année scolaire.
            </p>
          )}
          <div className="grid min-w-0 gap-2">
            {selectedEntry.children.map((child) => (
              <article key={child.id} className="grid min-w-0 gap-2 rounded border border-slate-200 bg-white p-3">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-bold text-ink">{child.displayName}</p>
                    <p className="break-words text-sm text-slate-500">{fallbackText(child.matricule)}</p>
                  </div>
                  <span className={`w-fit rounded px-2 py-1 text-xs font-semibold ${child.statusLabel === "Actif" ? "bg-mint/10 text-mint" : "bg-slate-100 text-slate-600"}`}>
                    {child.statusLabel}
                  </span>
                </div>
                <p className="break-words text-sm font-semibold text-slate-700">{child.classLabel}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-3 border-b border-slate-100 bg-white pb-3">
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
          Recherche
          <span className="relative block min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPrintError("");
              }}
              className="input pl-9"
              placeholder="Nom, téléphone, e-mail, enfant, matricule, classe..."
            />
          </span>
        </label>

        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Classe
            <select
              value={classFilter}
              onChange={(event) => {
                setClassFilter(event.target.value);
                setPrintError("");
              }}
              className="input"
            >
              <option value="">Toutes les classes</option>
              {classChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={printDirectory}
            disabled={printing || filteredEntries.length === 0}
            type="button"
            className="primary-button w-full justify-center self-end disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Download className="h-4 w-4" /> {printing ? "Préparation..." : "Imprimer"}
          </button>
        </div>

        {printError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{printError}</p>}

        <div className="flex min-w-0 items-center justify-between gap-3 rounded bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-700">{filteredEntries.length} parent(s) / tuteur(s)</p>
          <p className="text-xs font-medium text-slate-500">{entries.length} au total</p>
        </div>
      </div>

      <div ref={listScrollRef} className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto pr-1 scrollbar-thin">
        {filteredEntries.length === 0 && (
          <p className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">
            Aucun parent ou tuteur ne correspond à cette recherche.
          </p>
        )}
        {filteredEntries.map((entry) => (
          <article key={entry.parent.id} className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => openParent(entry.parent.id)}
                  type="button"
                  className="break-words text-left font-bold text-ink underline-offset-2 hover:text-blue-700 hover:underline"
                >
                  {fallbackText(entry.parent.fullName)}
                </button>
                <p className="mt-1 text-sm text-slate-500">{entry.children.length} enfant(s) lié(s)</p>
              </div>
            </div>
            <div className="grid min-w-0 gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <p className="flex min-w-0 items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 break-words">{fallbackText(entry.parent.phone)}</span>
              </p>
              <p className="flex min-w-0 items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 break-words">{fallbackText(entry.parent.email)}</span>
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
