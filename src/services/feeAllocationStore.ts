/** Lot « répartition rapide » : un seul chargement du drawer « Répartition des frais » par session,
 * gardé en mémoire de l'onglet (jamais sur le disque), affiché tout de suite à chaque ouverture.
 * L'empreinte des changements est lue AVANT les données : si quelque chose change pendant la
 * lecture, l'empreinte gardée est l'ancienne et la vérification suivante recharge. Une donnée
 * n'est donc jamais présentée comme à jour alors qu'elle ne l'est pas. */
import { useEffect } from "react";
import { allocationRequest, loadAllocationWorkspace, type AllocationWorkspace } from "./feeAllocation";

export type AllocationSnapshot = { workspaces: AllocationWorkspace[]; tokens: Record<string, string | null>; loadedAt: number };
type Entry = { snapshot?: AllocationSnapshot; started?: number; pending?: Promise<AllocationSnapshot> };

const store = new Map<string, Entry>();
export const allocationStoreKey = (userId: string, schoolIds: string[]) => `${userId}:${[...schoolIds].sort().join("|")}`;
const usedKey = (userId: string) => `acadea:repartition-utilisee:${userId}`;

async function inBatches<T>(ids: string[], load: (id: string) => Promise<T>) {
  const results: T[] = [];
  for (let index = 0; index < ids.length; index += 4) results.push(...await Promise.all(ids.slice(index, index + 4).map(load)));
  return results;
}
export async function readAllocationTokens(schoolIds: string[], signal?: AbortSignal) {
  const answers = await inBatches(schoolIds, (schoolId) => allocationRequest<{ schoolId: string; token?: string }>("get-forecast-revision", { schoolId }, signal));
  const tokens: Record<string, string | null> = {};
  answers.forEach((answer, index) => {
    if (answer.schoolId !== schoolIds[index]) throw new Error("Contexte de vérification invalide.");
    tokens[answer.schoolId] = answer.token ?? null;
  });
  return tokens;
}

/** Chargement complet (empreinte d'abord), partagé : deux demandes simultanées ne lisent qu'une fois. */
let sequence = 0;
/** `force` : un changement vient d'être fait sur cet appareil ; un chargement déjà en cours a pu
 * commencer avant lui, il n'est donc pas réutilisé. Seul le chargement le plus récent est gardé. */
export function loadAllocationSnapshot(userId: string, schoolIds: string[], force = false): Promise<AllocationSnapshot> {
  const key = allocationStoreKey(userId, schoolIds);
  const entry = store.get(key) ?? {};
  if (entry.pending && !force) return entry.pending;
  const ids = [...schoolIds].sort(), started = ++sequence;
  const self: { pending?: Promise<AllocationSnapshot> } = {};
  const pending = (async () => {
    const tokens = await readAllocationTokens(ids);
    const workspaces = await inBatches(ids, (id) => loadAllocationWorkspace(id));
    const snapshot = { workspaces, tokens, loadedAt: Date.now() };
    const current = store.get(key);
    if (!current?.snapshot || (current.started ?? 0) <= started) store.set(key, { snapshot, started, ...(current?.pending && current.pending !== self.pending ? { pending: current.pending } : {}) });
    return snapshot;
  })();
  self.pending = pending;
  store.set(key, { ...entry, pending });
  pending.catch(() => undefined).finally(() => { const current = store.get(key); if (current?.pending === pending) store.set(key, { snapshot: current.snapshot, started: current.started }); });
  return pending;
}

export const peekAllocationSnapshot = (userId: string, schoolIds: string[]) => store.get(allocationStoreKey(userId, schoolIds))?.snapshot ?? null;
export const pendingAllocationSnapshot = (userId: string, schoolIds: string[]) => store.get(allocationStoreKey(userId, schoolIds))?.pending ?? null;

/** Vrai seulement si l'empreinte de chaque école est identique à celle des données gardées. */
export async function allocationSnapshotIsCurrent(snapshot: AllocationSnapshot, signal?: AbortSignal) {
  const ids = Object.keys(snapshot.tokens).sort();
  if (!ids.length || ids.some((id) => !snapshot.tokens[id])) return false;
  const current = await readAllocationTokens(ids, signal);
  return ids.every((id) => current[id] === snapshot.tokens[id]);
}

export function forgetAllocationSnapshots(userId?: string) {
  for (const key of [...store.keys()]) if (!userId || key.startsWith(`${userId}:`)) store.delete(key);
}

/** Préchargement à la connexion : seulement pour un compte qui a déjà ouvert ce drawer sur cet
 * appareil (sinon il ajouterait des lectures pour des comptes qui ne l'utilisent jamais). */
export function rememberAllocationUse(userId: string) {
  try { localStorage.setItem(usedKey(userId), "1"); } catch { /* stockage indisponible : simple confort */ }
}
export function allocationUsedOnThisDevice(userId: string) {
  try { return localStorage.getItem(usedKey(userId)) === "1"; } catch { return false; }
}
export function prefetchAllocationSnapshot(userId: string, schoolIds: string[]) {
  if (!schoolIds.length || !allocationUsedOnThisDevice(userId)) return;
  if (peekAllocationSnapshot(userId, schoolIds) || pendingAllocationSnapshot(userId, schoolIds)) return;
  void loadAllocationSnapshot(userId, schoolIds).catch(() => undefined);
}

const prefetchRoles = new Set(["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"]);
/** À appeler dès que le compte et ses écoles sont connus : préparation discrète, après l'affichage. */
export function usePrefetchAllocation(user: { id: string; role: string } | null | undefined, schoolIds: string[]) {
  const key = user && prefetchRoles.has(user.role) ? allocationStoreKey(user.id, schoolIds.filter(Boolean)) : "";
  const userId = user?.id ?? "";
  // Déconnexion : rien n'est gardé pour le compte suivant.
  useEffect(() => { if (!userId) forgetAllocationSnapshots(); }, [userId]);
  useEffect(() => {
    if (!key || !user) return;
    const ids = key.slice(user.id.length + 1).split("|").filter(Boolean);
    const timer = window.setTimeout(() => prefetchAllocationSnapshot(user.id, ids), 2500);
    return () => window.clearTimeout(timer);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
