import { useEffect, useState } from "react";
import type { Expense } from "../types";
import { resolveHistoricalExpenseCurrencies } from "../services/financialTransactions";

export function useResolvedExpenseCurrencies(expenses: Expense[]) {
  const [result, setResult] = useState<{ source: Expense[]; rows: Expense[] }>();
  useEffect(() => {
    let cancelled = false;
    void resolveHistoricalExpenseCurrencies(expenses).then((rows) => {
      if (!cancelled) setResult({ source: expenses, rows });
    });
    return () => { cancelled = true; };
  }, [expenses]);
  // A new Firestore snapshot stays unresolved until its linked evidence is rechecked.
  return result?.source === expenses ? result.rows : expenses;
}
