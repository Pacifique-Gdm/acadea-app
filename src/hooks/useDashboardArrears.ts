import { useEffect, useMemo, useRef, useState } from "react";
import type { Payment, Student } from "../types";
import { auth } from "../firebase";
import { reportClientFailure } from "../services/clientFailureTelemetry";
import { readCachedArrears, refreshStaleArrears } from "../services/dashboardArrearsCache";
import { failureKind, plainFailureMessage } from "../services/requestFailure";
import { useAutoRetry } from "./useAutoRetry";

/** Reuse the canonical historical-debt API, never equate current-year balance
 * with overdue debt. Refresh on confirmed ledger changes, without polling.
 * Les totaux déjà vérifiés pour des données identiques sont réaffichés
 * immédiatement (retour sur le tableau de bord) ; seuls les élèves dont les
 * données ont changé sont redemandés au serveur. */
export function useDashboardArrears(students: Student[], payments: Payment[], coordination = false) {
  const scope = auth?.currentUser?.uid ?? "";
  const studentKey = JSON.stringify(students.map(({ id, schoolId, schoolYearId, financialSupport }) => ({ id, schoolId, schoolYearId, financialSupport })).sort((a, b) => a.id.localeCompare(b.id)));
  const paymentKey = JSON.stringify(payments.map(({ id, amount, studentId, currentStudentId, schoolYearId }) => ({ id, amount, studentId, currentStudentId, schoolYearId })).sort((a, b) => a.id.localeCompare(b.id)));
  const key = `${scope}:${coordination}:${studentKey}:${paymentKey}`;
  const [version, setVersion] = useState(0);
  const [failure, setFailure] = useState<{ key: string; error: string }>();
  const { token: retryToken, schedule, succeeded } = useAutoRetry();
  const latest = useRef({ students, payments });
  latest.current = { students, payments };
  // `version` relit la mémoire après un recalcul ; `key` suit les données.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cached = useMemo(() => readCachedArrears(latest.current.students, latest.current.payments, scope, coordination), [key, version, scope, coordination]);

  useEffect(() => {
    if (!cached.stale.length) return undefined;
    let cancelled = false;
    const startedAt = Date.now();
    void refreshStaleArrears(cached.stale, cached.prints, scope, coordination, { isCancelled: () => cancelled })
      .then(() => { if (!cancelled) { succeeded(); setFailure(undefined); setVersion((value) => value + 1); } })
      .catch((error) => {
        if (cancelled) return;
        const kind = failureKind(error);
        const retrying = schedule(kind);
        setFailure({ key, error: plainFailureMessage(kind, retrying) });
        void reportClientFailure("dashboard.arrears", error, startedAt);
      });
    return () => { cancelled = true; };
  }, [cached, coordination, key, retryToken, schedule, scope, succeeded]);

  if (cached.totals) return { key, totals: cached.totals, error: undefined };
  return { key, totals: undefined, error: failure?.key === key ? failure.error : undefined };
}
