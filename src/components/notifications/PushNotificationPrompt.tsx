import { useCallback, useEffect, useState } from "react";
import type { AppUser } from "../../types";
import { enablePushNotifications, getPushNotificationStatus, type PushNotificationStatus } from "../../services/pushNotifications";
import { ANDROID_BLOCKED_STEPS, detectPushDevice, IOS_BLOCKED_STEPS, IOS_INSTALL_STEPS, needsIosInstall, PUSH_PROMPT_SNOOZE_KEY, PUSH_STATUS_RECHECK_MS, pushPromptDue, pushPromptVisible, pushSettingsVisible } from "../../utils/pushPrompt";
import { ErrorNotice } from "../ui/ErrorNotice";

function currentDevice() {
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
  return detectPushDevice(typeof navigator === "undefined" ? "" : navigator.userAgent, Boolean(standalone));
}

// Lot 25 : « Plus tard » est propre à chaque compte (un parent ne perd pas le bandeau parce qu'un autre compte l'a repoussé sur ce téléphone).
function readSnooze(userId: string) { try { return window.localStorage.getItem(`${PUSH_PROMPT_SNOOZE_KEY}:${userId}`); } catch { return null; } }
function writeSnooze(userId: string) { try { window.localStorage.setItem(`${PUSH_PROMPT_SNOOZE_KEY}:${userId}`, new Date().toISOString()); } catch { /* sans stockage : redemande à la prochaine connexion */ } }
// Lot 26 : une fois activées, l'ancien « Plus tard » est oublié, pour que le bandeau revienne aussitôt si elles se désactivent.
function clearSnooze(userId: string) { try { window.localStorage.removeItem(`${PUSH_PROMPT_SNOOZE_KEY}:${userId}`); } catch { /* sans stockage */ } }

/** État et activation des notifications, partagés par le bandeau et le réglage du Menu. */
export function usePushNotificationState(user: AppUser) {
  const [status, setStatus] = useState<PushNotificationStatus | "loading">("loading");
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    void getPushNotificationStatus(user).then(setStatus).catch(() => setStatus("unsupported"));
  }, [user]);
  useEffect(() => {
    refresh();
    // Lot 26 : revérifie au retour sur l'application, quand l'autorisation du téléphone change, et chaque minute.
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, PUSH_STATUS_RECHECK_MS);
    let permission: PermissionStatus | null = null;
    void navigator.permissions?.query({ name: "notifications" as PermissionName }).then((result) => { permission = result; result.onchange = refresh; }).catch(() => undefined);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      if (permission) permission.onchange = null;
    };
  }, [refresh]);
  useEffect(() => { if (status === "enabled") clearSnooze(user.id); }, [status, user.id]);
  const enable = useCallback(async () => {
    setError("");
    try {
      const result = await enablePushNotifications(user);
      if (result.status === "permission-denied") setStatus("blocked");
      else if (result.status === "enabled") setStatus("enabled");
      else setError("Activation impossible sur cet appareil pour le moment.");
    } catch { setError("Activation impossible sur cet appareil pour le moment."); }
    refresh();
  }, [refresh, user]);
  return { status, error, enable, device: currentDevice() };
}

function Steps({ title, steps }: { title: string; steps: string[] }) {
  return <div className="grid gap-1 text-sm"><p className="font-semibold">{title}</p><ol className="list-decimal pl-5">{steps.map((step) => <li key={step}>{step}</li>)}</ol></div>;
}

/** Explications selon l'appareil : installation iPhone, ou réactivation après un refus. */
export function PushNotificationHelp({ status, device }: { status: PushNotificationStatus | "loading"; device: ReturnType<typeof currentDevice> }) {
  if (needsIosInstall(device)) return <Steps title="Sur iPhone, installez d'abord Acadéa sur l'écran d'accueil (sans cela, aucune notification ne peut arriver) :" steps={IOS_INSTALL_STEPS} />;
  if (status === "blocked") return <Steps title="Les notifications sont bloquées sur ce téléphone. Pour les réactiver :" steps={device.ios ? IOS_BLOCKED_STEPS : ANDROID_BLOCKED_STEPS} />;
  return null;
}

/** Bandeau affiché après la connexion tant que les notifications ne sont pas activées. Ne bloque jamais l'utilisation. */
export function PushNotificationPrompt({ user }: { user: AppUser }) {
  const { status, error, enable, device } = usePushNotificationState(user);
  const [visible, setVisible] = useState(() => pushPromptDue(typeof window === "undefined" ? null : readSnooze(user.id)));
  // Lot 26 : une fois activées, le bandeau pourra revenir immédiatement si elles cessent d'être actives.
  useEffect(() => { if (status === "enabled") setVisible(true); }, [status]);
  if (!pushPromptVisible(status, device, visible)) return null;
  const later = () => { writeSnooze(user.id); setVisible(false); };
  return <div role="region" aria-label="Activer les notifications" className="mx-auto mt-2 grid max-w-6xl gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
    <p className="font-semibold">Activez les notifications pour recevoir vos messages et paiements, même quand l'application est fermée.</p>
    <PushNotificationHelp status={status} device={device} />
    <ErrorNotice error={error} />
    <div className="flex flex-wrap gap-2">
      {!needsIosInstall(device) && status !== "blocked" && <button type="button" className="primary-button" onClick={() => void enable()}>Activer</button>}
      <button type="button" className="secondary-button" onClick={later}>Plus tard</button>
    </div>
  </div>;
}

/** Réglage « Notifications » du Menu : état et activation à tout moment. */
export function PushNotificationSettings({ user }: { user: AppUser }) {
  const { status, error, enable, device } = usePushNotificationState(user);
  if (!pushSettingsVisible(status)) return null;
  const label = status === "enabled" ? "Activées sur cet appareil" : status === "blocked" ? "Bloquées dans les réglages du téléphone" : status === "not_configured" ? "Non disponibles pour le moment" : status === "unsupported" ? (needsIosInstall(device) ? "Installez d'abord Acadéa sur l'écran d'accueil" : "Non prises en charge par ce navigateur") : status === "loading" ? "Vérification…" : "Désactivées sur cet appareil";
  return <section aria-label="Notifications" className="grid gap-2 rounded border border-slate-200 bg-white p-4 text-sm shadow-sm">
    <h3 className="font-bold text-ink">Notifications</h3>
    <p>État : <strong>{label}</strong></p>
    <PushNotificationHelp status={status} device={device} />
    <ErrorNotice error={error} />
    {status === "available" && <button type="button" className="primary-button w-fit" onClick={() => void enable()}>Activer</button>}
  </section>;
}
