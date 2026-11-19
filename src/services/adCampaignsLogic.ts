/**
 * Campagnes publicitaires dans l'en-tête : règles sans accès réseau.
 *
 * - Dates en jours « AAAA-MM-JJ » à l'heure de Kinshasa, début et fin inclus.
 * - Plusieurs campagnes peuvent viser la même école : elles tournent, chacune
 *   selon sa « part d'affichage » (une campagne à 2 passe deux fois plus souvent).
 * - Statistiques : uniquement des totaux (jour, appareil, rôle, école), jamais
 *   de nom, de compte ni d'identifiant d'appareil. Le rôle n'est jamais croisé
 *   avec l'école.
 */
import type { Role } from "../types";

export const AD_TIME_ZONE = "Africa/Kinshasa";
export const AD_DEFAULT_ROTATION_SECONDS = 30;
export const AD_MIN_ROTATION_SECONDS = 10;
export const AD_MAX_ROTATION_SECONDS = 600;
export const AD_MIN_WEIGHT = 1;
export const AD_MAX_WEIGHT = 10;
export const AD_MAX_ACTIVE_CAMPAIGNS = 30;
export const AD_MAX_TARGET_SCHOOLS = 500;
export const AD_STATS_SHARDS = 20;
/** Plafond d'un envoi groupé (même plafond dans les règles Firestore). */
export const AD_MAX_VIEWS_PER_REPORT = 2000;
export const AD_MAX_CLICKS_PER_REPORT = 500;
export const AD_DESKTOP_IMAGE = { width: 1200, height: 150, maxBytes: 40_000 } as const;
export const AD_PHONE_IMAGE = { width: 720, height: 240, maxBytes: 20_000 } as const;

export const AD_AUDIENCE_ROLES = [
  "school_admin",
  "cashier",
  "discipline_director",
  "study_director",
  "secretary",
  "teacher",
  "parent",
  "coordination",
] as const;
export type AdAudienceRole = typeof AD_AUDIENCE_ROLES[number];

export const AD_AUDIENCE_ROLE_LABELS: Record<AdAudienceRole, string> = {
  school_admin: "Administrateur d'école",
  cashier: "Caissier",
  discipline_director: "Directeur de discipline",
  study_director: "Directeur des études",
  secretary: "Secrétaire",
  teacher: "Enseignant",
  parent: "Parent",
  coordination: "Coordination",
};

/** Rôles cochés par défaut dans une nouvelle campagne (« Coordination » décoché). */
export const AD_DEFAULT_ROLES: AdAudienceRole[] = AD_AUDIENCE_ROLES.filter((role) => role !== "coordination");

export type AdTargetMode = "all" | "schools" | "coordination";
export type AdCampaignStatus = "draft" | "scheduled" | "stopped";
export type AdDevice = "desktop" | "phone";

export type AdCampaign = {
  id: string;
  brand: string;
  linkUrl: string;
  startDate: string;
  endDate: string;
  targetMode: AdTargetMode;
  schoolIds: string[];
  coordinationId: string;
  roles: AdAudienceRole[];
  weight: number;
  status: AdCampaignStatus;
  desktopVersion: string;
  phoneVersion: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

/** Ce que lisent les appareils : un seul petit document pour toutes les campagnes. */
export type ActiveAdCampaign = Pick<AdCampaign,
  "id" | "brand" | "linkUrl" | "startDate" | "endDate" | "targetMode" | "schoolIds" | "coordinationId" | "roles" | "weight" | "desktopVersion" | "phoneVersion">;

export type AdsActiveSettings = {
  rotationSeconds: number;
  campaigns: ActiveAdCampaign[];
  updatedAt: string;
};

export type AdViewer = {
  role: AdAudienceRole;
  schoolId: string;
  coordinationId: string;
};

export type AdPhase = "draft" | "scheduled" | "running" | "ended" | "stopped";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Jour du calendrier à Kinshasa, au format AAAA-MM-JJ. */
export function adDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: AD_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function isAdDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftAdDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function adDaysBetween(startDate: string, endDate: string): string[] {
  if (!isAdDay(startDate) || !isAdDay(endDate) || startDate > endDate) return [];
  const days: string[] = [];
  for (let day = startDate; day <= endDate && days.length < 400; day = shiftAdDay(day, 1)) days.push(day);
  return days;
}

export function formatAdDay(day: string): string {
  return isAdDay(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "—";
}

/** Rôle de l'application → public de la publicité (null : jamais de publicité). */
export function adAudienceRoleFor(role: Role | "admin" | string | undefined): AdAudienceRole | null {
  if (role === "admin") return "school_admin";
  if (role === "coordination_admin" || role === "sub_coordination_admin") return "coordination";
  return (AD_AUDIENCE_ROLES as readonly string[]).includes(String(role)) && role !== "coordination" ? role as AdAudienceRole : null;
}

export function clampRotationSeconds(value: unknown): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return AD_DEFAULT_ROTATION_SECONDS;
  return Math.min(AD_MAX_ROTATION_SECONDS, Math.max(AD_MIN_ROTATION_SECONDS, number));
}

export function clampWeight(value: unknown): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return AD_MIN_WEIGHT;
  return Math.min(AD_MAX_WEIGHT, Math.max(AD_MIN_WEIGHT, number));
}

export function campaignPhase(campaign: Pick<AdCampaign, "status" | "startDate" | "endDate">, today: string): AdPhase {
  if (campaign.status === "draft") return "draft";
  if (campaign.status === "stopped") return "stopped";
  if (campaign.endDate < today) return "ended";
  if (campaign.startDate > today) return "scheduled";
  return "running";
}

export const AD_PHASE_LABELS: Record<AdPhase, string> = {
  draft: "Brouillon",
  scheduled: "Programmée",
  running: "En cours",
  ended: "Terminée",
  stopped: "Arrêtée",
};

export function campaignTargetsViewer(campaign: ActiveAdCampaign, viewer: AdViewer, today: string): boolean {
  if (!isAdDay(campaign.startDate) || !isAdDay(campaign.endDate)) return false;
  if (today < campaign.startDate || today > campaign.endDate) return false;
  if (!campaign.roles.includes(viewer.role)) return false;
  if (!campaign.desktopVersion && !campaign.phoneVersion) return false;
  if (viewer.role === "coordination") {
    if (campaign.targetMode === "all") return true;
    return campaign.targetMode === "coordination" && Boolean(viewer.coordinationId) && campaign.coordinationId === viewer.coordinationId;
  }
  if (!viewer.schoolId) return false;
  if (campaign.targetMode === "all") return true;
  if (campaign.targetMode === "schools") return campaign.schoolIds.includes(viewer.schoolId);
  return Boolean(viewer.coordinationId) && campaign.coordinationId === viewer.coordinationId;
}

export function campaignsForViewer(settings: AdsActiveSettings | null | undefined, viewer: AdViewer | null, today: string): ActiveAdCampaign[] {
  if (!settings || !viewer) return [];
  return settings.campaigns.filter((campaign) => campaignTargetsViewer(campaign, viewer, today));
}

/**
 * Ordre de passage pondéré et régulier (« tourniquet pondéré lissé ») :
 * parts 2 et 1 → A, B, A ; parts 1, 1 → A, B. Une campagne à 2 apparaît deux
 * fois plus souvent, sans passer deux fois de suite quand c'est évitable.
 */
export function buildAdRotation(campaigns: Array<Pick<ActiveAdCampaign, "id" | "weight">>): string[] {
  const items = campaigns.map((campaign) => ({ id: campaign.id, weight: clampWeight(campaign.weight), current: 0 }));
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const order: string[] = [];
  for (let step = 0; step < total; step += 1) {
    let best = items[0];
    for (const item of items) {
      item.current += item.weight;
      if (item.current > best.current) best = item;
    }
    best.current -= total;
    order.push(best.id);
  }
  return order;
}

/** Contenu du document lu par les appareils, recalculé à chaque enregistrement. */
export function buildActiveSettings(campaigns: AdCampaign[], rotationSeconds: number, today: string, updatedAt: string): AdsActiveSettings {
  const active = campaigns
    .filter((campaign) => campaign.status === "scheduled" && isAdDay(campaign.endDate) && campaign.endDate >= today)
    .sort((first, second) => first.startDate.localeCompare(second.startDate) || first.id.localeCompare(second.id))
    .slice(0, AD_MAX_ACTIVE_CAMPAIGNS)
    .map((campaign): ActiveAdCampaign => ({
      id: campaign.id,
      brand: campaign.brand,
      linkUrl: campaign.linkUrl,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      targetMode: campaign.targetMode,
      schoolIds: campaign.targetMode === "schools" ? [...campaign.schoolIds] : [],
      coordinationId: campaign.targetMode === "coordination" ? campaign.coordinationId : "",
      roles: [...campaign.roles],
      weight: clampWeight(campaign.weight),
      desktopVersion: campaign.desktopVersion,
      phoneVersion: campaign.phoneVersion,
    }));
  return { rotationSeconds: clampRotationSeconds(rotationSeconds), campaigns: active, updatedAt };
}

/** Lecture prudente du document « campagnes actives » (données venues du réseau). */
export function parseActiveSettings(raw: unknown): AdsActiveSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  const parsed: ActiveAdCampaign[] = [];
  for (const entry of campaigns) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) continue;
    if (typeof item.linkUrl !== "string" || !isSafeAdLink(item.linkUrl)) continue;
    if (!isAdDay(item.startDate) || !isAdDay(item.endDate)) continue;
    const targetMode = item.targetMode === "schools" || item.targetMode === "coordination" ? item.targetMode : "all";
    parsed.push({
      id: item.id,
      brand: typeof item.brand === "string" ? item.brand : "",
      linkUrl: item.linkUrl,
      startDate: item.startDate,
      endDate: item.endDate,
      targetMode,
      schoolIds: Array.isArray(item.schoolIds) ? item.schoolIds.filter((value): value is string => typeof value === "string") : [],
      coordinationId: typeof item.coordinationId === "string" ? item.coordinationId : "",
      roles: Array.isArray(item.roles) ? item.roles.filter((value): value is AdAudienceRole => (AD_AUDIENCE_ROLES as readonly unknown[]).includes(value)) : [],
      weight: clampWeight(item.weight),
      desktopVersion: typeof item.desktopVersion === "string" ? item.desktopVersion : "",
      phoneVersion: typeof item.phoneVersion === "string" ? item.phoneVersion : "",
    });
  }
  return {
    rotationSeconds: clampRotationSeconds(data.rotationSeconds ?? AD_DEFAULT_ROTATION_SECONDS),
    campaigns: parsed,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
  };
}

export function isSafeAdLink(value: string): boolean {
  if (value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export type AdCampaignDraft = Omit<AdCampaign, "id" | "createdAt" | "updatedAt" | "updatedBy" | "desktopVersion" | "phoneVersion"> & {
  desktopImage: string;
  phoneImage: string;
};

/** Contrôle du formulaire. Un brouillon peut rester incomplet (marque exigée). */
export function validateAdCampaign(draft: AdCampaignDraft, options: { publish: boolean }): string[] {
  const errors: string[] = [];
  const brand = draft.brand.trim();
  if (!brand) errors.push("Indiquez la marque.");
  if (brand.length > 60) errors.push("Le nom de la marque doit faire 60 caractères au plus.");
  if (draft.linkUrl && !isSafeAdLink(draft.linkUrl.trim())) errors.push("Le lien doit commencer par https:// et être une adresse valide.");
  if (draft.schoolIds.length > AD_MAX_TARGET_SCHOOLS) errors.push(`${AD_MAX_TARGET_SCHOOLS} écoles au plus par campagne ; choisissez « Toutes les écoles » ou une Coordination.`);
  if (draft.weight < AD_MIN_WEIGHT || draft.weight > AD_MAX_WEIGHT || !Number.isInteger(draft.weight)) errors.push(`La part d'affichage doit être un nombre entier de ${AD_MIN_WEIGHT} à ${AD_MAX_WEIGHT}.`);
  if (!options.publish) return errors;
  if (!draft.linkUrl.trim()) errors.push("Indiquez le lien du clic.");
  if (!isAdDay(draft.startDate) || !isAdDay(draft.endDate)) errors.push("Indiquez les dates de début et de fin.");
  else if (draft.startDate > draft.endDate) errors.push("La date de fin doit être le même jour ou après la date de début.");
  if (!draft.desktopImage) errors.push("Ajoutez l'image ordinateur.");
  if (!draft.phoneImage) errors.push("Ajoutez l'image téléphone.");
  if (draft.roles.length === 0) errors.push("Cochez au moins un rôle.");
  if (draft.targetMode === "schools" && draft.schoolIds.length === 0) errors.push("Choisissez au moins une école.");
  if (draft.targetMode === "coordination" && !draft.coordinationId) errors.push("Choisissez une Coordination.");
  return errors;
}

/* ------------------------------------------------------------------ */
/* Statistiques groupées                                               */
/* ------------------------------------------------------------------ */

/** Paquet (0 à 19) d'une école : toujours le même pour une même école. */
export function adStatsShard(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return hash % AD_STATS_SHARDS;
}

export function adStatsDocId(campaignId: string, day: string, shard: number): string {
  return `${campaignId}_${day}_${shard}`;
}

export type AdStatsReport = {
  campaignId: string;
  day: string;
  device: AdDevice;
  role: AdAudienceRole;
  /** École (vide pour la Coordination). */
  schoolId: string;
  /** Clé de paquet : l'école, ou la Coordination pour les coordinateurs. */
  shardKey: string;
  views: number;
  clicks: number;
};

export function adStatsSafeKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

/**
 * Champs ajoutés par un envoi groupé (tous des additions). Noms courts et à
 * plat pour que les règles Firestore puissent les vérifier un par un.
 */
export function adStatsIncrements(report: AdStatsReport): Record<string, number> {
  const views = Math.min(AD_MAX_VIEWS_PER_REPORT, Math.max(0, Math.floor(report.views)));
  const clicks = Math.min(AD_MAX_CLICKS_PER_REPORT, Math.max(0, Math.floor(report.clicks)));
  const device = report.device === "phone" ? "p" : "d";
  const fields: Record<string, number> = {
    v: views,
    c: clicks,
    [`v${device}`]: views,
    [`c${device}`]: clicks,
    [`r_${report.role}_v`]: views,
    [`r_${report.role}_c`]: clicks,
  };
  if (report.schoolId) {
    fields[`s_${report.schoolId}_v`] = views;
    fields[`s_${report.schoolId}_c`] = clicks;
  }
  return fields;
}

export type AdStatsSummary = {
  views: number;
  clicks: number;
  byDay: Array<{ day: string; views: number; clicks: number }>;
  byDevice: Record<AdDevice, { views: number; clicks: number }>;
  byRole: Array<{ role: AdAudienceRole; views: number; clicks: number }>;
  bySchool: Array<{ schoolId: string; views: number; clicks: number }>;
};

export function summarizeAdStats(documents: Array<Record<string, unknown>>): AdStatsSummary {
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const byDay = new Map<string, { views: number; clicks: number }>();
  const byRole = new Map<AdAudienceRole, { views: number; clicks: number }>();
  const bySchool = new Map<string, { views: number; clicks: number }>();
  const summary: AdStatsSummary = { views: 0, clicks: 0, byDay: [], byDevice: { desktop: { views: 0, clicks: 0 }, phone: { views: 0, clicks: 0 } }, byRole: [], bySchool: [] };
  const bump = <K>(map: Map<K, { views: number; clicks: number }>, key: K, kind: "views" | "clicks", amount: number) => {
    const entry = map.get(key) ?? { views: 0, clicks: 0 };
    entry[kind] += amount;
    map.set(key, entry);
  };
  for (const data of documents) {
    const day = typeof data.date === "string" ? data.date : "";
    summary.views += number(data.v);
    summary.clicks += number(data.c);
    summary.byDevice.desktop.views += number(data.vd);
    summary.byDevice.desktop.clicks += number(data.cd);
    summary.byDevice.phone.views += number(data.vp);
    summary.byDevice.phone.clicks += number(data.cp);
    if (day) {
      bump(byDay, day, "views", number(data.v));
      bump(byDay, day, "clicks", number(data.c));
    }
    for (const [field, value] of Object.entries(data)) {
      const roleMatch = /^r_(.+)_(v|c)$/.exec(field);
      if (roleMatch && (AD_AUDIENCE_ROLES as readonly string[]).includes(roleMatch[1])) {
        bump(byRole, roleMatch[1] as AdAudienceRole, roleMatch[2] === "v" ? "views" : "clicks", number(value));
        continue;
      }
      const schoolMatch = /^s_(.+)_(v|c)$/.exec(field);
      if (schoolMatch) bump(bySchool, schoolMatch[1], schoolMatch[2] === "v" ? "views" : "clicks", number(value));
    }
  }
  summary.byDay = [...byDay.entries()].map(([day, value]) => ({ day, ...value })).sort((first, second) => first.day.localeCompare(second.day));
  summary.byRole = [...byRole.entries()].map(([role, value]) => ({ role, ...value })).sort((first, second) => second.views - first.views);
  summary.bySchool = [...bySchool.entries()].map(([schoolId, value]) => ({ schoolId, ...value })).sort((first, second) => second.views - first.views || first.schoolId.localeCompare(second.schoolId));
  return summary;
}

/* ------------------------------------------------------------------ */
/* Comptes gardés sur l'appareil avant l'envoi groupé                  */
/* ------------------------------------------------------------------ */

export type PendingAdStats = Record<string, AdStatsReport>;

export function pendingKey(report: Pick<AdStatsReport, "campaignId" | "day" | "device" | "role" | "schoolId">): string {
  return [report.campaignId, report.day, report.device, report.role, report.schoolId].join("|");
}

export function recordAdEvent(pending: PendingAdStats, event: Omit<AdStatsReport, "views" | "clicks">, kind: "view" | "click"): PendingAdStats {
  const key = pendingKey(event);
  const current = pending[key] ?? { ...event, views: 0, clicks: 0 };
  const next = { ...current };
  if (kind === "view") next.views = Math.min(AD_MAX_VIEWS_PER_REPORT, next.views + 1);
  else next.clicks = Math.min(AD_MAX_CLICKS_PER_REPORT, next.clicks + 1);
  return { ...pending, [key]: next };
}

/**
 * Envois prêts : seulement les jours terminés (avant aujourd'hui), pour un
 * seul envoi par campagne et par jour. Les comptes de plus de 30 jours sont
 * abandonnés (appareil resté éteint très longtemps).
 */
export function readyAdReports(pending: PendingAdStats, today: string): { ready: Array<[string, AdStatsReport]>; expired: string[] } {
  const oldest = shiftAdDay(today, -30);
  const ready: Array<[string, AdStatsReport]> = [];
  const expired: string[] = [];
  for (const [key, report] of Object.entries(pending)) {
    if (!isAdDay(report.day) || report.day < oldest) expired.push(key);
    else if (report.day < today && (report.views > 0 || report.clicks > 0)) ready.push([key, report]);
    else if (report.day < today) expired.push(key);
  }
  return { ready, expired };
}
