/** Plan d'écriture d'une collection après une modification locale (updateData).
 * - nouvelle fiche (identifiant à créer) : création conditionnelle, comme avant ;
 * - fiche inconnue de l'état précédent : fiche entière, comme avant ;
 * - fiche identique : aucune écriture ;
 * - fiche modifiée : seulement les champs modifiés (les champs supprimés sont
 *   effacés), sauf si un nom de champ contient un caractère qui serait lu comme
 *   un chemin (« . », « ` », « / », « [ », « ] », « * », « ~ ») : alors fiche entière ;
 * - fiche absente de la nouvelle liste : aucune suppression, exactement comme avant ;
 * - fiche supprimée côté serveur entre-temps : jamais recréée (l'erreur est remontée). */
export type PersistableRecord = { id: string } & Record<string, unknown>;
export type PlannedWrite =
  | { id: string; mode: "create" | "full"; item: PersistableRecord }
  | { id: string; mode: "fields"; item: PersistableRecord; changed: Record<string, unknown>; removed: string[] };

const UNSAFE_FIELD = /[.`/[\]*~]/;

/** Égalité profonde indépendante de l'ordre des clés d'objet. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((value, index) => sameValue(value, (b as unknown[])[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return keys.length === otherKeys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
}

export function planCollectionWrites(previous: readonly PersistableRecord[] | undefined, next: readonly PersistableRecord[], createIds: readonly string[] = []): PlannedWrite[] {
  const known = new Map((previous ?? []).map((item) => [item.id, item]));
  const creations = new Set(createIds);
  const plan: PlannedWrite[] = [];
  for (const item of next) {
    if (creations.has(item.id)) { plan.push({ id: item.id, mode: "create", item }); continue; }
    const before = known.get(item.id);
    if (!before) { plan.push({ id: item.id, mode: "full", item }); continue; }
    if (sameValue(before, item)) continue;
    const keys = new Set([...Object.keys(before), ...Object.keys(item)]);
    const changed: Record<string, unknown> = {};
    const removed: string[] = [];
    for (const key of keys) {
      const had = before[key] !== undefined, has = item[key] !== undefined;
      if (has && (!had || !sameValue(before[key], item[key]))) changed[key] = item[key];
      else if (had && !has) removed.push(key);
    }
    const touched = [...Object.keys(changed), ...removed];
    if (!touched.length) continue;
    if (touched.some((key) => key === "id" || UNSAFE_FIELD.test(key))) plan.push({ id: item.id, mode: "full", item });
    else plan.push({ id: item.id, mode: "fields", item, changed, removed });
  }
  return plan;
}

/** Après un échec d'écriture, on garde la dernière version CONFIRMÉE de chaque
 * fiche concernée : le réessai compare à cette version et n'envoie que les
 * champs réellement modifiés depuis (jamais la fiche entière). */
export function rememberUnconfirmedBases(bases: Map<string, PersistableRecord>, previous: object, patch: object) {
  const source = previous as Record<string, unknown>;
  for (const [key, items] of Object.entries(patch)) {
    if (!Array.isArray(items)) continue;
    const before = Array.isArray(source[key]) ? new Map((source[key] as PersistableRecord[]).map((item) => [item.id, item])) : new Map<string, PersistableRecord>();
    for (const item of items as PersistableRecord[]) {
      const identity = `${key}/${item?.id}`;
      const confirmed = before.get(item?.id);
      if (!bases.has(identity) && confirmed) bases.set(identity, confirmed);
    }
  }
}

export function previousWithConfirmedBase<T extends object>(previous: T, patch: Partial<T>, bases: ReadonlyMap<string, PersistableRecord>): Partial<T> {
  const source = previous as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const items = source[key];
    result[key] = Array.isArray(items) ? items.map((item: PersistableRecord) => bases.get(`${key}/${item?.id}`) ?? item) : items;
  }
  return result as Partial<T>;
}

export function patchIdentities(patch: Record<string, unknown>) {
  return Object.entries(patch).flatMap(([key, items]) => (Array.isArray(items) ? items.map((item: { id?: string }) => `${key}/${item?.id}`) : []));
}
