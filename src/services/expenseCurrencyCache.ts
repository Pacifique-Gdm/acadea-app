import type { Expense } from "../types";
import { resolveHistoricalExpenseCurrencies } from "./financialTransactions";

/** Devise retrouvée par le serveur pour une ancienne dépense de paie, gardée
 * en mémoire de l'onglet navigateur. Elle provient de la pièce de paie liée :
 * elle est réutilisée tant que la dépense pointe vers la même pièce. Une
 * dépense que le serveur ne sait pas résoudre est mémorisée « sans devise »
 * pour ne pas la redemander à chaque rafraîchissement ; elle reste bloquante
 * pour les exports comme avant.
 *
 * Les devises retrouvées (USD ou CDF) sont aussi gardées dans le navigateur,
 * par compte : à la prochaine ouverture, le Dashboard n'a pas à refaire la
 * vérification. La devise est redemandée si la dépense change (pièce de paie,
 * montant, école, année ou date de modification) et, dans tous les cas, après
 * 24 heures : une correction faite côté serveur est donc vue au plus tard le
 * lendemain. Les cas « sans devise » ne sont jamais gardés au-delà de l'onglet :
 * ils sont redemandés à chaque ouverture. */
type Resolved = { print: string; currency: "USD" | "CDF" | null; savedAt: number };
/** Durée de vie d'une devise mémorisée (onglet et navigateur). */
export const EXPENSE_CURRENCY_TTL_MS = 24 * 60 * 60 * 1000;
export type ExpenseCurrencyRequest = (expenses: Expense[], failOnError: boolean) => Promise<Expense[]>;

const cache = new Map<string, Resolved>();

const STORAGE_PREFIX = "acadea.expenseCurrencies.v2:";
const STORAGE_LIMIT = 5000;
type Stored = Record<string, [print: string, currency: "USD" | "CDF", savedAt: number]>;
/** Empreinte de la dépense : pièce de paie, montant, école, année et date de modification.
 * Si l'un d'eux change, la devise est redemandée. */
const expensePrint = (expense: Expense) => JSON.stringify([expense.personnelPaymentId ?? "", expense.amount, expense.schoolId, expense.schoolYearId, expense.updatedAt ?? ""]);
const fresh = (savedAt: number) => Number.isFinite(savedAt) && savedAt <= Date.now() && Date.now() - savedAt < EXPENSE_CURRENCY_TTL_MS;
const hydratedScopes = new Set<string>();

function storage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}

function readStored(scope: string): Stored {
  try {
    const raw = storage()?.getItem(STORAGE_PREFIX + scope);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Stored : {};
  } catch { return {}; }
}

/** Recharge une seule fois par compte les devises déjà retrouvées lors d'une ouverture précédente. */
function hydrate(scope: string) {
  if (!scope || hydratedScopes.has(scope)) return;
  hydratedScopes.add(scope);
  for (const [expenseId, value] of Object.entries(readStored(scope))) {
    if (!Array.isArray(value) || typeof value[0] !== "string" || (value[1] !== "USD" && value[1] !== "CDF") || !fresh(Number(value[2]))) continue;
    const key = cacheKey(scope, expenseId);
    if (!cache.has(key)) cache.set(key, { print: value[0], currency: value[1], savedAt: Number(value[2]) });
  }
}

function persist(scope: string, rows: Array<{ expenseId: string; entry: Resolved }>) {
  const target = storage();
  if (!scope || !target) return;
  try {
    const stored = readStored(scope);
    for (const { expenseId, entry } of rows) {
      if (entry.currency) stored[expenseId] = [entry.print, entry.currency, entry.savedAt];
      else delete stored[expenseId];
    }
    const entries = Object.entries(stored).filter(([, value]) => Array.isArray(value) && fresh(Number(value[2])));
    target.setItem(STORAGE_PREFIX + scope, JSON.stringify(Object.fromEntries(entries.slice(Math.max(0, entries.length - STORAGE_LIMIT)))));
  } catch { /* stockage plein ou indisponible : la mémoire de l'onglet suffit */ }
}
const cacheKey = (scope: string, expenseId: string) => `${scope}\u001f${expenseId}`;

export function expenseNeedsResolution(expense: Expense) {
  return !expense.currency && Boolean(expense.personnelPaymentId);
}

function cachedEntry(expense: Expense, scope: string) {
  hydrate(scope);
  const entry = cache.get(cacheKey(scope, expense.id));
  return entry && entry.print === expensePrint(expense) && fresh(entry.savedAt) ? entry : undefined;
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
  const saved: Array<{ expenseId: string; entry: Resolved }> = [];
  for (const expense of pending) {
    const currency = byId.get(expense.id)?.currency;
    const entry: Resolved = { print: expensePrint(expense), savedAt: Date.now(), currency: currency === "USD" || currency === "CDF" ? currency : null };
    cache.set(cacheKey(scope, expense.id), entry);
    saved.push({ expenseId: expense.id, entry });
  }
  persist(scope, saved);
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

/** Vide la mémoire de l'onglet. `includeStorage` efface aussi les devises gardées dans le navigateur. */
export function clearExpenseCurrencyCache(includeStorage = true) {
  cache.clear();
  hydratedScopes.clear();
  rowsCache = new WeakMap();
  const target = storage();
  if (!includeStorage || !target) return;
  try {
    for (let index = target.length - 1; index >= 0; index -= 1) {
      const key = target.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) target.removeItem(key);
    }
  } catch { /* stockage indisponible */ }
}
