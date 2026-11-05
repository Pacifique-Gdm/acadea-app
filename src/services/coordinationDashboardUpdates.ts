import { collection, onSnapshot, query, where, type Firestore } from "@firebase/firestore";
import { coordinationSchoolBatches } from "./coordinationSchoolBatches";

/** Invalidate the existing read model only after server-confirmed changes.
 * Queries retain the same school scope and rules access-call budget. */
export function subscribeCoordinationDashboardUpdates(database: Firestore, schoolIds: string[], isDelegate: boolean,
  reload: () => Promise<void>, onError: () => void) {
  let stopped = false, running = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    timer = undefined;
    if (stopped || running) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        try { await reload(); } catch { if (!stopped) onError(); }
      }
    } finally { running = false; }
  };
  const changed = () => {
    if (stopped) return;
    dirty = true;
    if (!running && timer === undefined) timer = setTimeout(() => void flush(), 300);
  };
  const stops: Array<() => void> = [];
  for (const ids of coordinationSchoolBatches(schoolIds, isDelegate)) {
    for (const name of ["students", "feeTypes", "payments", "expenses", "cashInflows", "schoolYears"]) {
      stops.push(onSnapshot(query(collection(database, name), where("schoolId", "in", ids)), { includeMetadataChanges: true }, (snapshot) => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites && snapshot.docChanges().length) changed();
      }, () => { if (!stopped) onError(); }));
    }
  }
  return () => { stopped = true; dirty = false; if (timer !== undefined) clearTimeout(timer); stops.forEach(stop => stop()); };
}
