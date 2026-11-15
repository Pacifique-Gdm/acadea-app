/** Réutilise les tableaux (et l'objet) précédents quand leur contenu est
 * identique élément par élément : un écran qui dépend de `students` ne se
 * recalcule plus parce qu'un autre tableau, ou rien, a changé. */
export function reuseUnchanged<T extends object>(next: T, previous: T | undefined): T {
  if (!previous) return next;
  const source = next as Record<string, unknown>;
  const before = previous as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== Object.keys(before).length) return next;
  let allReused = true;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    const old = before[key];
    const same = Object.is(value, old) || (Array.isArray(value) && Array.isArray(old) && value.length === old.length && value.every((item, index) => Object.is(item, old[index])));
    result[key] = same ? old : value;
    if (!same) allReused = false;
  }
  return allReused ? previous : result as T;
}

/** Garde le dernier résultat d'une fonction pure tant que ses arguments sont identiques. */
export function lastResult<A extends unknown[], R>(compute: (...args: A) => R) {
  let last: { args: A; value: R } | undefined;
  return (...args: A): R => {
    if (last && last.args.length === args.length && last.args.every((value, index) => Object.is(value, args[index]))) return last.value;
    const value = compute(...args);
    last = { args, value };
    return value;
  };
}

/** Objet précédent conservé tant que ses champs sont identiques (comparaison simple). */
export function reuseShallow<T extends object>(next: T, previous: T | undefined): T {
  if (!previous) return next;
  const a = next as Record<string, unknown>, b = previous as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key])) ? previous : next;
}
