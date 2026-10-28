import type { AppUser } from "../types";

export type OfflineAccess = {
  userId: string;
  role: "teacher" | "discipline_director" | "school_admin" | "secretary" | "cashier";
  schoolId: string;
  schoolName: string;
  schoolYearId: string;
  schoolYearName: string;
  verifiedAt: string;
  expiresAt: string;
};

const DATABASE_NAME = "acadea-offline-access-v1";
const ACCESS_DURATION_MS = 8 * 60 * 60 * 1000;
const permittedRoles = new Set<OfflineAccess["role"]>(["teacher", "discipline_director", "school_admin", "secretary", "cashier"]);

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Stockage local indisponible."));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Stockage local interrompu."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Stockage local impossible."));
  });
}

async function open(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) throw new Error("Accès local sécurisé indisponible sur cet appareil.");
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains("access")) request.result.createObjectStore("access");
    if (!request.result.objectStoreNames.contains("keys")) request.result.createObjectStore("keys");
  };
  return result(request);
}

export function offlineAccessEligible(user: AppUser): user is AppUser & { role: OfflineAccess["role"] } {
  return permittedRoles.has(user.role as OfflineAccess["role"]) && Boolean(user.schoolId)
    && user.active !== false && user.status !== "inactive";
}

/** Called only after Firebase Auth and the current school/year have loaded online. */
export async function rememberOfflineAccess(input: Omit<OfflineAccess, "verifiedAt" | "expiresAt">, now = Date.now()): Promise<void> {
  if (!permittedRoles.has(input.role) || !input.userId || !input.schoolId || !input.schoolYearId) {
    throw new Error("Périmètre d'accès local invalide.");
  }
  const ticket: OfflineAccess = { ...input, verifiedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ACCESS_DURATION_MS).toISOString() };
  const database = await open();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
      new TextEncoder().encode(JSON.stringify(ticket)));
    const write = database.transaction(["access", "keys"], "readwrite");
    // Only the most recently verified account may reopen on this device.
    write.objectStore("access").clear();
    write.objectStore("keys").clear();
    write.objectStore("keys").put(key, "current");
    write.objectStore("access").put({ iv: [...iv], ciphertext }, "current");
    await completed(write);
  } finally { database.close(); }
}

export async function readOfflineAccess(userId: string, now = Date.now()): Promise<OfflineAccess | null> {
  if (!userId) return null;
  return readStoredOfflineAccess(userId, now);
}

/** A verified local ticket can reopen the same device when Firebase Auth reports no user offline. */
export async function readOfflineAccessForCurrentDevice(now = Date.now()): Promise<OfflineAccess | null> {
  return readStoredOfflineAccess(null, now);
}

async function readStoredOfflineAccess(userId: string | null, now: number): Promise<OfflineAccess | null> {
  const database = await open();
  try {
    const read = database.transaction(["access", "keys"], "readonly");
    const accessRequest = read.objectStore("access").get("current");
    const keyRequest = read.objectStore("keys").get("current");
    const [stored, key] = await Promise.all([result(accessRequest), result(keyRequest)]) as
      [{ iv: number[]; ciphertext: ArrayBuffer } | undefined, CryptoKey | undefined];
    if (!stored || !key) return null;
    const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(stored.iv) }, key, stored.ciphertext);
    const ticket = JSON.parse(new TextDecoder().decode(decoded)) as OfflineAccess;
    if ((userId !== null && ticket.userId !== userId) || !ticket.userId || !permittedRoles.has(ticket.role) || !ticket.schoolId || !ticket.schoolYearId
      || !Number.isFinite(Date.parse(ticket.verifiedAt)) || !Number.isFinite(Date.parse(ticket.expiresAt))
      || Date.parse(ticket.expiresAt) <= now || Date.parse(ticket.expiresAt) - Date.parse(ticket.verifiedAt) > ACCESS_DURATION_MS) return null;
    return ticket;
  } catch { return null; }
  finally { database.close(); }
}

export async function clearOfflineAccess(): Promise<void> {
  const database = await open();
  try {
    const write = database.transaction(["access", "keys"], "readwrite");
    write.objectStore("access").clear();
    write.objectStore("keys").clear();
    await completed(write);
  } finally { database.close(); }
}
