import { useEffect, useState } from "react";
import type { StudentStatusCounts } from "../services/studentPagination";

/** Nombres affichés à côté de chaque choix du filtre de statut. Ils ne sont recalculés que lorsque les
 * AUTRES filtres changent (classe, option, recherche…) : passer de « Filles » à « Actifs » ne relit rien. */
export function useStudentStatusCounts(key: string, load: () => Promise<StudentStatusCounts>) {
  const [counts, setCounts] = useState<{ key: string; value: StudentStatusCounts } | null>(null);
  useEffect(() => {
    let active = true;
    void load().then((value) => { if (active) setCounts({ key, value }); }).catch(() => { if (active) setCounts(null); });
    return () => { active = false; };
    // `load` change à chaque rendu ; seule la clé des autres filtres décide d'un nouveau comptage.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts?.key === key ? counts.value : null;
}

const labels = { all: "Tous", active: "Actifs", archived: "Archivés", girls: "Filles", boys: "Garçons" } as const;
export type StudentStatusChoice = keyof typeof labels;
export const studentStatusChoices = Object.keys(labels) as StudentStatusChoice[];
export const studentStatusLabel = (choice: StudentStatusChoice, counts: StudentStatusCounts | null) =>
  counts ? `${labels[choice]} (${counts[choice]})` : labels[choice];
export const missingSexNotice = (counts: StudentStatusCounts | null) => counts && counts.missingSex > 0
  ? `${counts.missingSex} élève${counts.missingSex > 1 ? "s" : ""} actif${counts.missingSex > 1 ? "s" : ""} sans sexe renseigné : ${counts.missingSex > 1 ? "ils n'apparaissent" : "il n'apparaît"} que dans « Tous » et « Actifs ». Complétez ${counts.missingSex > 1 ? "leur fiche" : "sa fiche"}.`
  : "";
