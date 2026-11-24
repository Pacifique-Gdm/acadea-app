/** Petit cache de session pour les écrans qui se ferment et se rouvrent (tiroirs « Année
 * scolaire ») : la première ouverture charge, les suivantes affichent tout de suite la même
 * réponse. La clé contient ce qui doit provoquer un vrai rechargement (école, année active,
 * bouton « Actualiser ») : une autre clé = un nouveau chargement. Deux ouvertures rapides
 * partagent le même appel. Un échec n'est pas gardé. */
export type LoadCache<T> = {
  peek: (key: string) => T | undefined;
  load: (key: string, loader: () => Promise<T>) => Promise<T>;
  set: (key: string, value: T) => void;
  clear: () => void;
};

export function createLoadCache<T>(maxEntries = 20): LoadCache<T> {
  const values = new Map<string, T>();
  const pending = new Map<string, Promise<T>>();
  const remember = (key: string, value: T) => {
    values.delete(key);
    values.set(key, value);
    while (values.size > maxEntries) values.delete(values.keys().next().value as string);
  };
  return {
    peek: (key) => values.get(key),
    load: (key, loader) => {
      if (values.has(key)) return Promise.resolve(values.get(key) as T);
      const running = pending.get(key);
      if (running) return running;
      const next = loader().then((value) => { remember(key, value); return value; }).finally(() => { pending.delete(key); });
      pending.set(key, next);
      return next;
    },
    set: remember,
    clear: () => { values.clear(); pending.clear(); },
  };
}
