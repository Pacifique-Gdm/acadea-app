import type { Expense } from "../types";
import { resolveHistoricalExpenseCurrencies } from "./financialTransactions";

/** Devise retrouvée par le serveur pour une ancienne dépense de paie, gardée
 * en mémoire de l'onglet navigateur. Elle provient de la pièce de paie liée :
 * elle est réutilisée tant que la dépense pointe vers la même pièce. Une
 * dépense que le serveur ne sait pas résoudre est mémorisée « sans devise »
 * pour ne pas la redemander à chaque rafraîchissement ; elle reste bloquante
 * pour les exports comme avant. */
type Resolved = { personnelPaymentId: string; currency: "USD" | "CDF" | null };
export type ExpenseCurrencyRequest = (expenses: Expense[], failOnError: boolean) => Promise<Expense[]>;

const cache = new Map<string, Resolved>();
const cacheKey = (scope: string, expenseId: string) => `${scope}\u001f${expenseId}`;

export function expenseNeedsResolution(expense: Expense) {
  return !expense.currency && Boolean(expense.personnelPaymentId);
}

function cachedEntry(expense: Expense, scope: string) {
  const entry = cache.get(cacheKey(scope, expense.id));
  return entry && entry.personnelPaymentId === expense.personnelPaymentId ? entry : undefined;
}

/** Identifiants triés des dépenses à faire vérifier par le serveur. */
export function pendingExpenseCurrencyIds(expenses: readonly Expense[], scope: string) {
  return [...new Set(expenses.filter((expense) => expenseNeedsResolution(expense) && !cachedEntry(expense, scope)).map((expense) => expense.id))].sort();
}

export function applyCachedExpenseCurrencies(expenses: Expense[], scope: string): Expense[] {
  return expenses.map((expense) => {
    if (!expenseNeedsResolution(expense)) return expense;
    const currency = cachedEntry(expense, scope)?.currency;
    return currency ? { ...expense, currency } : expense;
  });
}

export async function resolvePendingExpenseCurrencies(expenses: readonly Expense[], scope: string, request: ExpenseCurrencyRequest = resolveHistoricalExpenseCurrencies) {
  const pendingIds = new Set(pendingExpenseCurrencyIds(expenses, scope));
  const pending = [...new Map(expenses.filter((expense) => pendingIds.has(expense.id)).map((expense) => [expense.id, expense])).values()];
  if (!pending.length) return;
  const rows = await request(pending, true);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const expense of pending) {
    const currency = byId.get(expense.id)?.currency;
    cache.set(cacheKey(scope, expense.id), { personnelPaymentId: expense.personnelPaymentId ?? "", currency: currency === "USD" || currency === "CDF" ? currency : null });
  }
}

let rowsCache = new WeakMap<readonly Expense[], { scope: string; rows: Expense[] }>();

/** Même tableau résultat pour la même liste de dépenses (déjà entièrement
 * vérifiée) : les calculs qui en dépendent ne sont pas refaits au retour sur l'écran. */
export function cachedResolvedRows(expenses: Expense[], scope: string): Expense[] {
  const hit = rowsCache.get(expenses);
  if (hit && hit.scope === scope) return hit.rows;
  const rows = applyCachedExpenseCurrencies(expenses, scope);
  rowsCache.set(expenses, { scope, rows });
  return rows;
}

export function clearExpenseCurrencyCache() {
  cache.clear();
  rowsCache = new WeakMap();
}
