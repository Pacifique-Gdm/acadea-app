/**
 * Campagnes publicitaires : lectures et écritures Firestore.
 *
 * Coût maîtrisé :
 * - les appareils lisent UN seul petit document (`platformSettings/adsActive`),
 *   gardé une heure sur l'appareil ;
 * - chaque image est lue une fois par appareil et par campagne
 *   (`adCreatives/{campagne}_desktop|_phone`), puis gardée sur l'appareil ;
 * - les affichages et clics sont comptés sur l'appareil et envoyés en un seul
 *   paquet par campagne et par jour (`adStats/{campagne}_{jour}_{paquet}`) ;
 * - le Super administrateur ne lit les fiches et les statistiques que dans le
 *   tiroir « Campagnes publicitaires », jamais à l'ouverture du Dashboard.
 */
import type { Firestore } from "@firebase/firestore";
import {
  AD_DEFAULT_ROTATION_SECONDS,
  adDay,
  adStatsDocId,
  adStatsIncrements,
  adStatsShard,
  buildActiveSettings,
  parseActiveSettings,
  readyAdReports,
  recordAdEvent,
  type AdCampaign,
  type AdDevice,
  type AdStatsReport,
  type AdsActiveSettings,
  type PendingAdStats,
} from "./adCampaignsLogic";

export const AD_CAMPAIGNS_COLLECTION = "adCampaigns";
export const AD_CREATIVES_COLLECTION = "adCreatives";
export const AD_STATS_COLLECTION = "adStats";
export const AD_ACTIVE_DOC = { collection: "platformSettings", id: "adsActive" } as const;

const ACTIVE_CACHE_KEY = "acadea.adsActive";
const CREATIVE_CACHE_PREFIX = "acadea.adCreative.";
const PENDING_KEY = "acadea.adStats.pending";
export const AD_ACTIVE_CACHE_MS = 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

let storageOverride: StorageLike | null | undefined;
let activePromise: Promise<AdsActiveSettings | null> | null = null;
const creativeMemory = new Map<string, { version: string; promise: Promise<string> }>();

function storage(): StorageLike | null {
  if (storageOverride !== undefined) return storageOverride;
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; }
  catch { return null; }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

function writeJson(key: string, value: unknown) {
  try { storage()?.setItem(key, JSON.stringify(value)); } catch { /* stockage plein ou bloqué */ }
}

async function firestore() {
  const [{ db }, firestoreModule] = await Promise.all([import("../firebase"), import("@firebase/firestore")]);
  if (!db) throw new Error("Firestore indisponible.");
  return { ...firestoreModule, db: db as unknown as Firestore };
}

/* ------------------------------------------------------------------ */
/* Côté écoles : campagnes actives et images                          */
/* ------------------------------------------------------------------ */

/** Campagnes actives : relues au plus une fois par heure (sinon copie de l'appareil). */
export function loadActiveAds(options: { force?: boolean; now?: number } = {}): Promise<AdsActiveSettings | null> {
  const now = options.now ?? Date.now();
  const cached = readJson<{ fetchedAt?: number; settings?: unknown }>(ACTIVE_CACHE_KEY);
  if (!options.force && cached && typeof cached.fetchedAt === "number" && now - cached.fetchedAt < AD_ACTIVE_CACHE_MS && now >= cached.fetchedAt) {
    return Promise.resolve(parseActiveSettings(cached.settings));
  }
  if (activePromise) return activePromise;
  activePromise = (async () => {
    try {
      const { db, doc, getDoc } = await firestore();
      const snapshot = await getDoc(doc(db, AD_ACTIVE_DOC.collection, AD_ACTIVE_DOC.id));
      const settings = snapshot.exists() ? parseActiveSettings(snapshot.data()) : { rotationSeconds: AD_DEFAULT_ROTATION_SECONDS, campaigns: [], updatedAt: "" };
      writeJson(ACTIVE_CACHE_KEY, { fetchedAt: now, settings });
      cleanUnusedCreatives(settings?.campaigns.map((campaign) => campaign.id) ?? []);
      return settings;
    } catch (error) {
      // Hors ligne ou refus : on garde l'ancienne copie si elle existe, sinon rien.
      console.warn("Campagnes publicitaires indisponibles.", error);
      return cached ? parseActiveSettings(cached.settings) : null;
    } finally {
      activePromise = null;
    }
  })();
  return activePromise;
}

function creativeKey(campaignId: string, device: AdDevice) {
  return `${campaignId}_${device}`;
}

/** Image d'une campagne pour ce type d'écran ("" si absente). Une lecture par version. */
export function loadAdCreative(campaignId: string, device: AdDevice, version: string): Promise<string> {
  if (!campaignId || !version) return Promise.resolve("");
  const key = creativeKey(campaignId, device);
  const memory = creativeMemory.get(key);
  if (memory?.version === version) return memory.promise;
  const stored = readJson<{ version?: string; imageUrl?: string }>(CREATIVE_CACHE_PREFIX + key);
  if (stored?.version === version && typeof stored.imageUrl === "string") {
    const promise = Promise.resolve(stored.imageUrl);
    creativeMemory.set(key, { version, promise });
    return promise;
  }
  const promise = (async () => {
    try {
      const { db, doc, getDoc } = await firestore();
      const snapshot = await getDoc(doc(db, AD_CREATIVES_COLLECTION, key));
      const data = snapshot.exists() ? snapshot.data() : null;
      const imageUrl = data && data.version === version && typeof data.imageUrl === "string" && data.imageUrl.startsWith("data:image/") ? data.imageUrl : "";
      if (imageUrl) writeJson(CREATIVE_CACHE_PREFIX + key, { version, imageUrl });
      return imageUrl;
    } catch (error) {
      creativeMemory.delete(key);
      console.warn("Image de campagne indisponible.", error);
      return "";
    }
  })();
  creativeMemory.set(key, { version, promise });
  return promise;
}

/** Retire de l'appareil les images des campagnes qui ne sont plus actives. */
export function cleanUnusedCreatives(activeIds: string[]) {
  const target = storage();
  if (!target) return;
  const keep = new Set(activeIds);
  try {
    const remove: string[] = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (!key?.startsWith(CREATIVE_CACHE_PREFIX)) continue;
      const campaignId = key.slice(CREATIVE_CACHE_PREFIX.length).replace(/_(desktop|phone)$/, "");
      if (!keep.has(campaignId)) remove.push(key);
    }
    remove.forEach((key) => target.removeItem(key));
  } catch { /* rien à faire */ }
}

/* ------------------------------------------------------------------ */
/* Côté écoles : comptes groupés                                       */
/* ------------------------------------------------------------------ */

export type AdEvent = Omit<AdStatsReport, "views" | "clicks">;

function readPending(): PendingAdStats {
  return readJson<PendingAdStats>(PENDING_KEY) ?? {};
}

export function trackAdEvent(event: AdEvent, kind: "view" | "click") {
  writeJson(PENDING_KEY, recordAdEvent(readPending(), event, kind));
}

let flushing: Promise<number> | null = null;

/**
 * Envoie les comptes des jours terminés : une seule écriture par campagne,
 * par jour et par appareil. Renvoie le nombre d'envois réussis.
 */
export function flushAdStats(today: string = adDay()): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    const { ready, expired } = readyAdReports(readPending(), today);
    if (ready.length === 0 && expired.length === 0) return 0;
    let sent = 0;
    const done = new Set(expired);
    if (ready.length > 0) {
      try {
        const { db, doc, setDoc, increment } = await firestore();
        for (const [key, report] of ready) {
          const shard = adStatsShard(report.shardKey || report.schoolId || "aucune");
          const fields = adStatsIncrements(report);
          const payload: Record<string, unknown> = { campaignId: report.campaignId, date: report.day, shard };
          for (const [field, amount] of Object.entries(fields)) payload[field] = increment(amount);
          try {
            await setDoc(doc(db, AD_STATS_COLLECTION, adStatsDocId(report.campaignId, report.day, shard)), payload, { merge: true });
            done.add(key);
            sent += 1;
          } catch (error) {
            console.warn("Envoi des statistiques publicitaires reporté.", error);
            break;
          }
        }
      } catch (error) {
        console.warn("Envoi des statistiques publicitaires reporté.", error);
      }
    }
    if (done.size > 0) {
      const pending = readPending();
      done.forEach((key) => { delete pending[key]; });
      writeJson(PENDING_KEY, pending);
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

/* ------------------------------------------------------------------ */
/* Côté Super administrateur                                           */
/* ------------------------------------------------------------------ */

export type AdCampaignWithImages = AdCampaign & { desktopImage?: string; phoneImage?: string };

export async function listAdCampaigns(): Promise<{ campaigns: AdCampaign[]; rotationSeconds: number }> {
  const { db, collection, doc, getDoc, getDocs } = await firestore();
  const [snapshot, active] = await Promise.all([
    getDocs(collection(db, AD_CAMPAIGNS_COLLECTION)),
    getDoc(doc(db, AD_ACTIVE_DOC.collection, AD_ACTIVE_DOC.id)),
  ]);
  const campaigns = snapshot.docs.map((entry) => ({ ...(entry.data() as AdCampaign), id: entry.id }));
  const settings = active.exists() ? parseActiveSettings(active.data()) : null;
  return { campaigns, rotationSeconds: settings?.rotationSeconds ?? AD_DEFAULT_ROTATION_SECONDS };
}

export async function loadAdCampaignImages(campaignId: string): Promise<{ desktopImage: string; phoneImage: string }> {
  const { db, doc, getDoc } = await firestore();
  const [desktop, phone] = await Promise.all([
    getDoc(doc(db, AD_CREATIVES_COLLECTION, creativeKey(campaignId, "desktop"))),
    getDoc(doc(db, AD_CREATIVES_COLLECTION, creativeKey(campaignId, "phone"))),
  ]);
  return {
    desktopImage: desktop.exists() && typeof desktop.data().imageUrl === "string" ? desktop.data().imageUrl as string : "",
    phoneImage: phone.exists() && typeof phone.data().imageUrl === "string" ? phone.data().imageUrl as string : "",
  };
}

export async function computeAdImageVersion(imageUrl: string): Promise<string> {
  if (!imageUrl) return "";
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(imageUrl));
    return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Enregistre une campagne (et ses images si elles ont changé), puis recalcule
 * le document lu par les appareils, en une seule écriture groupée.
 */
export async function saveAdCampaign(params: {
  campaign: AdCampaign;
  desktopImage?: string;
  phoneImage?: string;
  allCampaigns: AdCampaign[];
  rotationSeconds: number;
}): Promise<AdCampaign[]> {
  const { db, doc, writeBatch } = await firestore();
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const campaign = { ...params.campaign };
  for (const device of ["desktop", "phone"] as const) {
    const image = device === "desktop" ? params.desktopImage : params.phoneImage;
    if (image === undefined) continue;
    const version = await computeAdImageVersion(image);
    const ref = doc(db, AD_CREATIVES_COLLECTION, creativeKey(campaign.id, device));
    if (image) batch.set(ref, { campaignId: campaign.id, format: device, imageUrl: image, version, updatedAt: now });
    else batch.delete(ref);
    if (device === "desktop") campaign.desktopVersion = version;
    else campaign.phoneVersion = version;
  }
  campaign.updatedAt = now;
  batch.set(doc(db, AD_CAMPAIGNS_COLLECTION, campaign.id), campaign);
  const nextCampaigns = [...params.allCampaigns.filter((entry) => entry.id !== campaign.id), campaign];
  batch.set(doc(db, AD_ACTIVE_DOC.collection, AD_ACTIVE_DOC.id), buildActiveSettings(nextCampaigns, params.rotationSeconds, adDay(), now));
  await batch.commit();
  return nextCampaigns;
}

/** Supprime une campagne qui n'a jamais été affichée (brouillon ou pas encore commencée). */
export async function deleteAdCampaign(params: { campaignId: string; allCampaigns: AdCampaign[]; rotationSeconds: number }): Promise<AdCampaign[]> {
  const { db, doc, writeBatch } = await firestore();
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.delete(doc(db, AD_CAMPAIGNS_COLLECTION, params.campaignId));
  batch.delete(doc(db, AD_CREATIVES_COLLECTION, creativeKey(params.campaignId, "desktop")));
  batch.delete(doc(db, AD_CREATIVES_COLLECTION, creativeKey(params.campaignId, "phone")));
  const nextCampaigns = params.allCampaigns.filter((entry) => entry.id !== params.campaignId);
  batch.set(doc(db, AD_ACTIVE_DOC.collection, AD_ACTIVE_DOC.id), buildActiveSettings(nextCampaigns, params.rotationSeconds, adDay(), now));
  await batch.commit();
  return nextCampaigns;
}

/** Change la durée de rotation (et nettoie au passage les campagnes terminées). */
export async function saveAdRotationSeconds(params: { rotationSeconds: number; allCampaigns: AdCampaign[] }): Promise<AdsActiveSettings> {
  const { db, doc, setDoc } = await firestore();
  const settings = buildActiveSettings(params.allCampaigns, params.rotationSeconds, adDay(), new Date().toISOString());
  await setDoc(doc(db, AD_ACTIVE_DOC.collection, AD_ACTIVE_DOC.id), settings);
  return settings;
}

/** Documents de statistiques d'une campagne (lus seulement à la demande). */
export async function loadAdStatsDocuments(campaignId: string): Promise<Array<Record<string, unknown>>> {
  const { db, collection, getDocs, query, where } = await firestore();
  const snapshot = await getDocs(query(collection(db, AD_STATS_COLLECTION), where("campaignId", "==", campaignId)));
  return snapshot.docs.map((entry) => entry.data() as Record<string, unknown>);
}

/** Réservé aux tests. */
export function resetAdCampaignCacheForTests(options: { storage?: StorageLike | null } = {}) {
  creativeMemory.clear();
  activePromise = null;
  flushing = null;
  storageOverride = "storage" in options ? options.storage : undefined;
}
