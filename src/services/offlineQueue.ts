// Technical foundation only: no business operation is sent by this module.
export type OfflineOperationStatus =
  | "LOCAL_PENDING"
  | "SYNCING"
  | "SERVER_CONFIRMED"
  | "CONFLICT"
  | "REJECTED"
  | "RETRYABLE_ERROR";

export type OfflineOperationKind = "grade" | "attendance" | "student_enrollment" | "payment_proposal";
export type OfflineScope = { userId: string; schoolId: string; schoolYearId: string };

export type OfflineOperation<T = unknown> = {
  id: string;
  kind: OfflineOperationKind;
  scope: OfflineScope;
  createdAt: string;
  expiresAt: string;
  status: OfflineOperationStatus;
  attempts: number;
  payload: T;
  error?: string;
};

type StoredOperation = Omit<OfflineOperation, "payload"> & { partition: string; iv: number[]; ciphertext: ArrayBuffer };
const DATABASE_NAME = "acadea-offline-operations-v1";
const DATABASE_VERSION = 1;
const RETENTION_DAYS = 30;

function partition(scope: OfflineScope): string {
  for (const value of [scope.userId, scope.schoolId, scope.schoolYearId]) {
    if (!value || value.length > 160 || value.includes("\u0000")) throw new Error("Périmètre hors connexion invalide.");
  }
  return JSON.stringify([scope.userId, scope.schoolId, scope.schoolYearId]);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Stockage local indisponible."));
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Écriture locale interrompue."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Écriture locale impossible."));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) throw new Error("Stockage sécurisé hors connexion indisponible sur cet appareil.");
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("operations")) {
      database.createObjectStore("operations", { keyPath: "id" }).createIndex("partition", "partition");
    }
    if (!database.objectStoreNames.contains("keys")) database.createObjectStore("keys", { keyPath: "partition" });
  };
  return requestResult(request);
}

async function partitionKey(database: IDBDatabase, scopeKey: string): Promise<CryptoKey> {
  const read = database.transaction("keys", "readonly");
  const existing = await requestResult(read.objectStore("keys").get(scopeKey)) as { key: CryptoKey } | undefined;
  if (existing) return existing.key;
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const write = database.transaction("keys", "readwrite");
  const store = write.objectStore("keys");
  const raced = await requestResult(store.get(scopeKey)) as { key: CryptoKey } | undefined;
  if (raced) return raced.key;
  store.put({ partition: scopeKey, key: generated });
  await finished(write);
  return generated;
}

const nextStatus: Record<OfflineOperationStatus, OfflineOperationStatus[]> = {
  LOCAL_PENDING: ["SYNCING", "REJECTED"],
  SYNCING: ["SERVER_CONFIRMED", "CONFLICT", "REJECTED", "RETRYABLE_ERROR"],
  SERVER_CONFIRMED: [],
  CONFLICT: ["LOCAL_PENDING", "REJECTED"],
  REJECTED: [],
  RETRYABLE_ERROR: ["LOCAL_PENDING", "SYNCING", "REJECTED"],
};

export async function queueOfflineOperation<T>(scope: OfflineScope, kind: OfflineOperationKind, payload: T): Promise<OfflineOperation<T>> {
  const scopeKey = partition(scope);
  if (!["grade", "attendance", "student_enrollment", "payment_proposal"].includes(kind)) throw new Error("Type d'opération locale invalide.");
  const database = await openDatabase();
  try {
    const key = await partitionKey(database, scopeKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    const createdAt = new Date().toISOString();
    const operation: OfflineOperation<T> = { id: crypto.randomUUID(), kind, scope, createdAt,
      expiresAt: new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString(), status: "LOCAL_PENDING", attempts: 0, payload };
    const write = database.transaction("operations", "readwrite");
    const metadata = { id: operation.id, kind: operation.kind, scope: operation.scope,
      createdAt: operation.createdAt, expiresAt: operation.expiresAt, status: operation.status, attempts: operation.attempts };
    write.objectStore("operations").add({ ...metadata, partition: scopeKey, iv: [...iv], ciphertext } satisfies StoredOperation);
    await finished(write);
    return operation;
  } finally { database.close(); }
}

export async function listOfflineOperations<T = unknown>(scope: OfflineScope): Promise<OfflineOperation<T>[]> {
  const scopeKey = partition(scope);
  const database = await openDatabase();
  try {
    const read = database.transaction("operations", "readonly");
    const rows = await requestResult(read.objectStore("operations").index("partition").getAll(scopeKey)) as StoredOperation[];
    if (!rows.length) return [];
    const key = await partitionKey(database, scopeKey);
    return Promise.all(rows.map(async ({ partition: storedScope, iv, ciphertext, ...row }) => {
      if (storedScope !== scopeKey) throw new Error("Périmètre local incohérent.");
      const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, ciphertext);
      return { ...row, payload: JSON.parse(new TextDecoder().decode(decoded)) as T };
    }));
  } finally { database.close(); }
}

export async function transitionOfflineOperation(scope: OfflineScope, id: string, status: OfflineOperationStatus, error?: string): Promise<void> {
  const scopeKey = partition(scope);
  const database = await openDatabase();
  try {
    const write = database.transaction("operations", "readwrite");
    const store = write.objectStore("operations");
    const row = await requestResult(store.get(id)) as StoredOperation | undefined;
    if (!row || row.partition !== scopeKey) throw new Error("Opération locale introuvable dans ce périmètre.");
    if (!nextStatus[row.status].includes(status)) throw new Error("Transition de synchronisation invalide.");
    store.put({ ...row, status, attempts: status === "SYNCING" ? row.attempts + 1 : row.attempts, error: error?.slice(0, 300) });
    await finished(write);
  } finally { database.close(); }
}

export async function removeConfirmedOfflineOperation(scope: OfflineScope, id: string): Promise<void> {
  const scopeKey = partition(scope);
  const database = await openDatabase();
  try {
    const write = database.transaction("operations", "readwrite");
    const store = write.objectStore("operations");
    const row = await requestResult(store.get(id)) as StoredOperation | undefined;
    if (!row || row.partition !== scopeKey || row.status !== "SERVER_CONFIRMED") throw new Error("Seule une opération confirmée de ce compte peut être nettoyée.");
    store.delete(id);
    await finished(write);
  } finally { database.close(); }
}
