import { useEffect, useMemo, useRef, useState } from "react";
import type { Expense } from "../types";
import { auth } from "../firebase";
import { reportClientFailure } from "../services/clientFailureTelemetry";
import { applyCachedExpenseCurrencies, expenseNeedsResolution, pendingExpenseCurrencyIds, resolvePendingExpenseCurrencies } from "../services/expenseCurrencyCache";
import { failureKind, plainFailureMessage } from "../services/requestFailure";
import { useAutoRetry } from "./useAutoRetry";

export function useResolvedExpenseCurrencies(expenses: Expense[]) {
  return useExpenseCurrencyResolution(expenses).rows;
}

/** L'appel serveur ne repart que si la liste des dépenses à vérifier change
 * réellement (identifiants), jamais parce que le tableau a été recréé. */
export function useExpenseCurrencyResolution(expenses: Expense[]) {
  const scope = auth?.currentUser?.uid ?? "";
  const needsResolution = expenses.some(expenseNeedsResolution);
  const [version, setVersion] = useState(0);
  const pendingKey = useMemo(() => pendingExpenseCurrencyIds(expenses, scope).join("|"), [expenses, scope, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const { token: retryToken, schedule, succeeded } = useAutoRetry();
  const latest = useRef(expenses);
  latest.current = expenses;

  useEffect(() => {
    if (!pendingKey) return undefined;
    let cancelled = false;
    const startedAt = Date.now();
    void resolvePendingExpenseCurrencies(latest.current, scope)
      .then(() => { if (!cancelled) { succeeded(); setFailure(undefined); setVersion((value) => value + 1); } })
      .catch((error) => {
        if (cancelled) return;
        const kind = failureKind(error);
        const retrying = schedule(kind);
        setFailure({ key: pendingKey, message: plainFailureMessage(kind, retrying) });
        void reportClientFailure("dashboard.currency", error, startedAt);
      });
    return () => { cancelled = true; };
  }, [pendingKey, retryToken, schedule, scope, succeeded]);

  const rows = useMemo(() => (needsResolution && !pendingKey ? applyCachedExpenseCurrencies(expenses, scope) : expenses), [expenses, needsResolution, pendingKey, scope]);
  if (!needsResolution) return { rows: expenses, status: "ready" as const, message: "" };
  if (!pendingKey) return { rows, status: "ready" as const, message: "" };
  if (failure?.key === pendingKey) return { rows: expenses, status: "error" as const, message: failure.message };
  return { rows: expenses, status: "loading" as const, message: "" };
}
