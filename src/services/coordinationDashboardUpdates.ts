import { collection, onSnapshot, query, where, type Firestore } from "@firebase/firestore";
import { coordinationSchoolBatches } from "./coordinationSchoolBatches";

/** Invalidate the existing read model only after server-confirmed changes.
 * Queries retain the same school scope and rules access-call budget. */
export function subscribeCoordinationDashboardUpdates(database: Firestore, schoolIds: string[], isDelegate: boolean,
  reload: (hadRealChange: boolean) => Promise<void>, onError: () => void, activeYears?: Readonly<Record<string, string>>) {
  // Lot 19 : la première réponse confirmée de chaque écoute ne contient que les données déjà
  // présentes ; seules les réponses suivantes sont de vrais changements (hadRealChange).
  let stopped = false, running = false, dirty = false, realChange = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    timer = undefined;
    if (stopped || running) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        const hadRealChange = realChange;
        realChange = false;
        try { await reload(hadRealChange); } catch { if (!stopped) onError(); }
      }
    } finally { running = false; }
  };
  const changed = (real: boolean) => {
    if (stopped) return;
    dirty = true;
    if (real) realChange = true;
    if (!running && timer === undefined) timer = setTimeout(() => void flush(), 300);
  };
  const stops: Array<() => void> = [];
  const watch = () => {
    let initialSeen = false;
    return (snapshot: { metadata: { fromCache: boolean; hasPendingWrites: boolean }; docChanges: () => unknown[] }) => {
      if (snapshot.metadata.fromCache) return;
      const initial = !initialSeen;
      initialSeen = true;
      if (!snapshot.metadata.hasPendingWrites && snapshot.docChanges().length) changed(!initial);
    };
  };
  const listen = (target: ReturnType<typeof query>) => stops.push(onSnapshot(target, { includeMetadataChanges: true }, watch(), () => { if (!stopped) onError(); }));
  if (activeYears) {
    // Lot 11 : par école, seulement l'année active (et les arriérés encaissés cette année).
    for (const schoolId of schoolIds) {
      const yearId = activeYears[schoolId];
      listen(query(collection(database, "schoolYears"), where("schoolId", "==", schoolId)));
      if (!yearId) continue;
      for (const name of ["students", "feeTypes", "payments", "expenses", "cashInflows"]) listen(query(collection(database, name), where("schoolId", "==", schoolId), where("schoolYearId", "==", yearId)));
      listen(query(collection(database, "payments"), where("schoolId", "==", schoolId), where("collectionSchoolYearId", "==", yearId)));
    }
    return () => { stopped = true; dirty = false; if (timer !== undefined) clearTimeout(timer); stops.forEach(stop => stop()); };
  }
  for (const ids of coordinationSchoolBatches(schoolIds, isDelegate)) {
    for (const name of ["students", "feeTypes", "payments", "expenses", "cashInflows", "schoolYears"]) {
      stops.push(onSnapshot(query(collection(database, name), where("schoolId", "in", ids)), { includeMetadataChanges: true }, watch(), () => { if (!stopped) onError(); }));
    }
  }
  return () => { stopped = true; dirty = false; if (timer !== undefined) clearTimeout(timer); stops.forEach(stop => stop()); };
}
