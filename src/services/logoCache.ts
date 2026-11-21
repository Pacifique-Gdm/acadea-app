/**
 * Logo complet rangé à part (écoles : `schoolLogos`, coordinations :
 * `coordinationLogos`).
 *
 * Le document principal ne garde que `logoVersion`, un repère qui change à
 * chaque nouveau logo, et la petite vignette des listes. Le logo complet est lu
 * seulement quand un écran l'affiche (drawer, en-tête, PDF), puis gardé en
 * mémoire et sur l'appareil tant que la version ne change pas.
 *
 * Compatibilité : un document qui porte encore l'ancien champ `logoUrl` l'affiche
 * directement, sans lecture supplémentaire.
 */
export type LogoSource = { id: string; logoUrl?: string; logoVersion?: string };
export type LogoRecord = { logoUrl?: string; logoVersion?: string } | null | undefined;
export type LogoLoader = (ownerId: string) => Promise<LogoRecord>;
export type LogoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type Entry = { version: string; promise: Promise<string>; value?: string };

export function createLogoCache(options: { collection: string; storagePrefix: string; warning: string }) {
  const memory = new Map<string, Entry>();
  let loader: LogoLoader = defaultLoader;
  let storageOverride: LogoStorage | null | undefined;

  async function defaultLoader(ownerId: string): Promise<LogoRecord> {
    const [{ db }, { doc, getDoc }] = await Promise.all([import("../firebase"), import("firebase/firestore")]);
    if (!db) return null;
    const snapshot = await getDoc(doc(db, options.collection, ownerId));
    return snapshot.exists() ? snapshot.data() as LogoRecord : null;
  }

  function storage(): LogoStorage | null {
    if (storageOverride !== undefined) return storageOverride;
    try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; }
    catch { return null; }
  }

  function readStored(ownerId: string, version: string): string | undefined {
    try {
      const raw = storage()?.getItem(options.storagePrefix + ownerId);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { version?: unknown; logoUrl?: unknown };
      return parsed.version === version && typeof parsed.logoUrl === "string" ? parsed.logoUrl : undefined;
    } catch { return undefined; }
  }

  function writeStored(ownerId: string, version: string, logoUrl: string) {
    try {
      const target = storage();
      if (!target) return;
      if (!logoUrl) target.removeItem(options.storagePrefix + ownerId);
      else target.setItem(options.storagePrefix + ownerId, JSON.stringify({ version, logoUrl }));
    } catch { /* stockage plein ou bloqué : la mémoire suffit */ }
  }

  const legacyLogo = (source: LogoSource) => typeof source.logoUrl === "string" ? source.logoUrl.trim() : "";
  const versionOf = (source: LogoSource) => typeof source.logoVersion === "string" ? source.logoVersion.trim() : "";

  function hasLogo(source: LogoSource | null | undefined) {
    return Boolean(source && (legacyLogo(source) || versionOf(source)));
  }

  function peek(source: LogoSource | null | undefined): string | undefined {
    if (!source) return "";
    const legacy = legacyLogo(source);
    if (legacy) return legacy;
    const version = versionOf(source);
    if (!version) return "";
    const cached = memory.get(source.id);
    if (cached?.version === version && cached.value !== undefined) return cached.value;
    const stored = readStored(source.id, version);
    if (stored !== undefined) {
      memory.set(source.id, { version, promise: Promise.resolve(stored), value: stored });
      return stored;
    }
    return undefined;
  }

  function load(source: LogoSource | null | undefined): Promise<string> {
    const known = peek(source);
    if (known !== undefined) return Promise.resolve(known);
    const owner = source as LogoSource;
    const version = versionOf(owner);
    const cached = memory.get(owner.id);
    if (cached?.version === version) return cached.promise;
    const entry: Entry = { version, promise: Promise.resolve("") };
    entry.promise = loader(owner.id)
      .then((record) => {
        const logoUrl = typeof record?.logoUrl === "string" ? record.logoUrl : "";
        entry.value = logoUrl;
        writeStored(owner.id, version, logoUrl);
        return logoUrl;
      })
      .catch((error) => {
        // Lecture impossible (hors ligne…) : on réessaiera au prochain affichage.
        if (memory.get(owner.id) === entry) memory.delete(owner.id);
        console.warn(options.warning, error);
        return "";
      });
    memory.set(owner.id, entry);
    return entry.promise;
  }

  function prime(ownerId: string, version: string, logoUrl: string) {
    if (!ownerId || !version) return;
    memory.set(ownerId, { version, promise: Promise.resolve(logoUrl), value: logoUrl });
    writeStored(ownerId, version, logoUrl);
  }

  function resetForTests(reset: { loader?: LogoLoader; storage?: LogoStorage | null } = {}) {
    memory.clear();
    loader = reset.loader ?? defaultLoader;
    storageOverride = "storage" in reset ? reset.storage : undefined;
  }

  return { hasLogo, peek, load, prime, resetForTests };
}

/** Repère de version d'un logo : empreinte courte de son contenu. */
export async function computeLogoVersion(logoUrl: string): Promise<string> {
  if (!logoUrl) return "";
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(logoUrl));
    return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}
