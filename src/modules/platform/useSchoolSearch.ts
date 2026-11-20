import { useEffect, useRef, useState } from "react";
import type { School } from "../../types";
import { schoolFromSearchRow, searchPlatformSchools, SchoolSearchUnavailableError, type SchoolSearchSort } from "../../services/schoolSearch";

/** Lot SA-2a : onglet « Écoles » branché sur la recherche faite par le serveur (pages de 25, « Voir plus »). */
export type ServerSchoolSearch = {
  /** null : la liste de recherche du serveur n'est pas prête ; l'écran garde alors la recherche locale. */
  schools: School[] | null;
  total: number;
  loading: boolean;
  error: string;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
};

/** Délai avant d'envoyer la recherche pendant la frappe (une seule demande pour un mot tapé d'un trait). */
export const SCHOOL_SEARCH_DELAY_MS = 300;

export function useServerSchoolSearch(filters: { query: string; status: string; schoolType: string; sort: SchoolSearchSort }, enabled = true): ServerSchoolSearch {
  const [schools, setSchools] = useState<School[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  const fresh = useRef(false);
  // Version 1.16.5 : dernière recherche terminée ; au retour sur l'onglet, la même recherche n'est pas refaite.
  const done = useRef("");
  const key = JSON.stringify(filters);
  // Nouveaux filtres : on repart de la première page.
  useEffect(() => { setPage(0); }, [key]);
  useEffect(() => {
    const signature = `${key}|${page}|${round}`;
    // Onglet quitté pendant une recherche : l'indicateur ne doit pas rester affiché au retour.
    if (!enabled || done.current === signature) { setLoading(false); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      const parsed = JSON.parse(key) as typeof filters;
      void searchPlatformSchools({ query: parsed.query, status: parsed.status as never, schoolType: parsed.schoolType, sort: parsed.sort, page, ...(fresh.current ? { fresh: true } : {}) })
        .then((result) => {
          if (!active) return;
          fresh.current = false;
          done.current = signature;
          const rows = result.schools.map(schoolFromSearchRow);
          setSchools((current) => (page === 0 || !current ? rows : [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))]));
          setTotal(result.total);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          if (cause instanceof SchoolSearchUnavailableError) { setSchools(null); return; }
          setError(cause instanceof Error ? cause.message : "Recherche des écoles indisponible.");
        })
        .finally(() => { if (active) setLoading(false); });
    }, page === 0 ? SCHOOL_SEARCH_DELAY_MS : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, page, round, enabled]);
  return {
    schools, total, loading, error,
    hasMore: Boolean(schools && schools.length < total),
    loadMore: () => setPage((value) => value + 1),
    // Après une création, une modification ou une suppression : relecture directe de la liste.
    refresh: () => { fresh.current = true; setPage(0); setRound((value) => value + 1); },
  };
}
