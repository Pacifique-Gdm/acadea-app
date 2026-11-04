import { useEffect, useState } from "react";
import type { Payment, Student } from "../types";
import { loadStudentArrearsBatch } from "../services/financialTransactions";
import { loadCoordinationStudentArrearsBatch } from "../services/coordinationService";
import { sumMoney } from "../utils/money";

/** Reuse the canonical historical-debt API, never equate current-year balance
 * with overdue debt. Refresh on confirmed ledger changes, without polling. */
export function useDashboardArrears(students: Student[], payments: Payment[], coordination = false) {
  const studentKey = JSON.stringify(students.map(({ id, schoolId, schoolYearId, financialSupport }) => ({ id, schoolId, schoolYearId, financialSupport })).sort((a, b) => a.id.localeCompare(b.id)));
  const paymentKey = JSON.stringify(payments.map(({ id, amount, studentId, currentStudentId, schoolYearId }) => ({ id, amount, studentId, currentStudentId, schoolYearId })).sort((a, b) => a.id.localeCompare(b.id)));
  const key = `${coordination}:${studentKey}:${paymentKey}`;
  const [result, setResult] = useState<{ key: string; totals?: { USD: number; CDF: number }; error?: string }>({ key: "" });
  useEffect(() => {
    let cancelled = false;
    const rows = JSON.parse(studentKey) as Pick<Student, "id" | "schoolYearId">[];
    const groups = new Map<string, string[]>();
    for (const row of rows) groups.set(row.schoolYearId, [...(groups.get(row.schoolYearId) ?? []), row.id]);
    void (async () => {
      const totals = { USD: 0, CDF: 0 };
      try {
        for (const [yearId, ids] of groups) {
          for (let offset = 0; offset < ids.length; offset += 50) {
            if (cancelled) return;
            const batch = [...new Set(ids.slice(offset, offset + 50))];
            const values = coordination ? await loadCoordinationStudentArrearsBatch(batch) : await loadStudentArrearsBatch(yearId, batch);
            for (const value of Object.values(values)) {
              totals.USD = sumMoney([totals.USD, value.USD]);
              totals.CDF = sumMoney([totals.CDF, value.CDF]);
            }
          }
        }
        if (!cancelled) setResult({ key, totals });
      } catch (error) {
        if (!cancelled) setResult({ key, error: error instanceof Error ? error.message : "Arriérés indisponibles." });
      }
    })();
    return () => { cancelled = true; };
  }, [coordination, key, studentKey]);
  return result.key === key ? result : { key, totals: undefined, error: undefined };
}
