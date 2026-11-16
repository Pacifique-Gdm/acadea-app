/** Lot 26b : la première réponse du serveur financier peut prendre ~5 s (réveil du serveur après
 * une période sans appel). La liste « Salaire/Prime » est donc préparée dès l'affichage du Menu
 * et gardée 2 minutes : à l'ouverture du drawer, elle est déjà là. Un échec n'est jamais gardé. */
export const OWN_PAYROLL_CACHE_MS = 2 * 60 * 1000;

type Entry<T> = { userId: string; at: number; promise: Promise<T> };

/** Le paramètre `userId` sert de clé (compte, ou école + année) ; le chargeur le reçoit. */
export function createOwnPayrollCache<T>(loader: (key: string) => Promise<T>, now: () => number = Date.now) {
  let entry: Entry<T> | null = null;
  return function load(userId: string, fresh = false): Promise<T> {
    if (!fresh && entry && entry.userId === userId && now() - entry.at < OWN_PAYROLL_CACHE_MS) return entry.promise;
    const current: Entry<T> = { userId, at: now(), promise: loader(userId) };
    entry = current;
    current.promise.catch(() => { if (entry === current) entry = null; });
    return current.promise;
  };
}
