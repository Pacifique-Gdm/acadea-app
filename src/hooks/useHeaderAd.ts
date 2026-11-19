import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adAudienceRoleFor,
  adDay,
  buildAdRotation,
  campaignsForViewer,
  type ActiveAdCampaign,
  type AdDevice,
  type AdViewer,
  type AdsActiveSettings,
} from "../services/adCampaignsLogic";
import { flushAdStats, loadActiveAds, loadAdCreative, trackAdEvent } from "../services/adCampaigns";
import { useAdsSuppressed } from "../services/adSuppression";

const PHONE_QUERY = "(max-width: 639px)";
export const AD_FADE_MS = 450;
const SETTINGS_CHECK_MS = 10 * 60 * 1000;

function currentDevice(): AdDevice {
  try { return typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches ? "phone" : "desktop"; }
  catch { return "desktop"; }
}

function useAdDevice(): AdDevice {
  const [device, setDevice] = useState<AdDevice>(currentDevice);
  useEffect(() => {
    const media = typeof window !== "undefined" ? window.matchMedia?.(PHONE_QUERY) : undefined;
    if (!media) return undefined;
    const update = () => setDevice(media.matches ? "phone" : "desktop");
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return device;
}

function usePageVisibleAndOnline() {
  const read = () => ({
    visible: typeof document === "undefined" || document.visibilityState !== "hidden",
    online: typeof navigator === "undefined" || navigator.onLine !== false,
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return state;
}

export type HeaderAdState = {
  campaign: ActiveAdCampaign;
  imageUrl: string;
  device: AdDevice;
  fading: boolean;
  onClick: () => void;
} | null;

/**
 * Bannière publicitaire de l'en-tête : campagnes qui visent cet utilisateur,
 * rotation pondérée avec fondu, comptes gardés sur l'appareil.
 * Renvoie null quand l'en-tête normal doit s'afficher.
 */
export function useHeaderAd(params: { role: string | undefined; schoolId?: string; coordinationId?: string | null; enabled?: boolean }): HeaderAdState {
  const audience = adAudienceRoleFor(params.role);
  const enabled = params.enabled !== false && audience !== null;
  const suppressed = useAdsSuppressed();
  const device = useAdDevice();
  const { visible, online } = usePageVisibleAndOnline();
  const [settings, setSettings] = useState<AdsActiveSettings | null>(null);
  const [today, setToday] = useState(adDay);
  const [images, setImages] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [fading, setFading] = useState(false);
  const counted = useRef("");

  const viewer = useMemo<AdViewer | null>(() => (audience ? {
    role: audience,
    schoolId: audience === "coordination" ? "" : params.schoolId ?? "",
    coordinationId: params.coordinationId ?? "",
  } : null), [audience, params.coordinationId, params.schoolId]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const run = () => {
      setToday(adDay());
      void loadActiveAds().then((next) => { if (active) setSettings(next); });
    };
    run();
    const timer = window.setInterval(run, SETTINGS_CHECK_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [enabled]);

  useEffect(() => {
    if (enabled && online) void flushAdStats(today);
  }, [enabled, online, today]);

  const versionOf = useCallback((campaign: ActiveAdCampaign) => (device === "phone" ? campaign.phoneVersion : campaign.desktopVersion), [device]);
  const imageKey = useCallback((campaign: ActiveAdCampaign) => `${campaign.id}|${device}|${versionOf(campaign)}`, [device, versionOf]);

  const eligible = useMemo(
    () => (enabled ? campaignsForViewer(settings, viewer, today).filter((campaign) => versionOf(campaign) && images[imageKey(campaign)] !== "") : []),
    [enabled, imageKey, images, settings, today, versionOf, viewer],
  );
  const rotation = useMemo(() => buildAdRotation(eligible), [eligible]);
  const currentId = rotation.length > 0 ? rotation[step % rotation.length] : "";
  const current = eligible.find((campaign) => campaign.id === currentId) ?? null;
  const nextId = rotation.length > 1 ? rotation[(step + 1) % rotation.length] : "";
  const next = eligible.find((campaign) => campaign.id === nextId) ?? null;

  // Images : celle affichée et la suivante (une lecture par campagne et par appareil).
  useEffect(() => {
    let active = true;
    for (const campaign of [current, next]) {
      if (!campaign) continue;
      const key = imageKey(campaign);
      if (key in images) continue;
      void loadAdCreative(campaign.id, device, versionOf(campaign)).then((imageUrl) => {
        if (active) setImages((known) => ({ ...known, [key]: imageUrl }));
      });
    }
    return () => { active = false; };
  }, [current, device, imageKey, images, next, versionOf]);

  // Rotation : changement toutes les N secondes, avec un fondu doux, seulement page visible.
  const rotationMs = (settings?.rotationSeconds ?? 30) * 1000;
  useEffect(() => {
    if (rotation.length < 2 || !visible || suppressed) return undefined;
    let fadeTimer = 0;
    const timer = window.setInterval(() => {
      setFading(true);
      fadeTimer = window.setTimeout(() => {
        setStep((value) => value + 1);
        setFading(false);
      }, AD_FADE_MS);
    }, rotationMs);
    return () => { window.clearInterval(timer); window.clearTimeout(fadeTimer); };
  }, [rotation.length, rotationMs, suppressed, visible]);

  const imageUrl = current ? images[imageKey(current)] ?? "" : "";
  const shown = Boolean(enabled && current && imageUrl && online && !suppressed);

  const event = useCallback((campaign: ActiveAdCampaign) => ({
    campaignId: campaign.id,
    day: today,
    device,
    role: audience!,
    schoolId: viewer?.schoolId ?? "",
    shardKey: viewer?.schoolId || viewer?.coordinationId || "",
  }), [audience, device, today, viewer]);

  // Un affichage compté à chaque passage visible d'une campagne.
  useEffect(() => {
    if (!shown || !current || !visible) return;
    const key = `${current.id}|${step}|${today}`;
    if (counted.current === key) return;
    counted.current = key;
    trackAdEvent(event(current), "view");
  }, [current, event, shown, step, today, visible]);

  const onClick = useCallback(() => {
    if (current) trackAdEvent(event(current), "click");
  }, [current, event]);

  if (!shown || !current) return null;
  return { campaign: current, imageUrl, device, fading, onClick };
}

