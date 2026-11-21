import { useEffect, useMemo, useState } from "react";
import { ImageUploadField } from "../ui/ImageUploadField";
import type { Coordination, School } from "../../types";
import {
  AD_AUDIENCE_ROLES,
  AD_AUDIENCE_ROLE_LABELS,
  AD_DEFAULT_ROLES,
  AD_DEFAULT_ROTATION_SECONDS,
  AD_DESKTOP_IMAGE,
  AD_MAX_ROTATION_SECONDS,
  AD_MAX_WEIGHT,
  AD_MIN_ROTATION_SECONDS,
  AD_PHASE_LABELS,
  AD_PHONE_IMAGE,
  adDay,
  campaignPhase,
  clampRotationSeconds,
  formatAdDay,
  summarizeAdStats,
  validateAdCampaign,
  type AdAudienceRole,
  type AdCampaign,
  type AdCampaignDraft,
  type AdPhase,
  type AdStatsSummary,
  type AdTargetMode,
} from "../../services/adCampaignsLogic";
import {
  deleteAdCampaign,
  listAdCampaigns,
  loadAdCampaignImages,
  loadAdStatsDocuments,
  saveAdCampaign,
  saveAdRotationSeconds,
} from "../../services/adCampaigns";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../ui/ErrorNotice";
import { useLoadRetry } from "../../hooks/useLoadRetry";

type View = "list" | "form" | "stats";

const phaseTone: Record<AdPhase, string> = {
  draft: "bg-slate-100 text-slate-600",
  scheduled: "bg-blue-50 text-blue-700",
  running: "bg-emerald-50 text-emerald-700",
  ended: "bg-slate-100 text-slate-500",
  stopped: "bg-amber-50 text-amber-700",
};

function newCampaignId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `ad${Date.now().toString(36)}${random}`;
}

function emptyDraft(): AdCampaignDraft {
  return {
    brand: "",
    linkUrl: "",
    startDate: "",
    endDate: "",
    targetMode: "all",
    schoolIds: [],
    coordinationId: "",
    roles: [...AD_DEFAULT_ROLES],
    weight: 1,
    status: "draft",
    desktopImage: "",
    phoneImage: "",
  };
}

function numberFr(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function percent(part: number, total: number) {
  if (total <= 0) return "0 %";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format((part / total) * 100)} %`;
}

export function AdCampaignsDrawer({ schools, coordinations, userId }: { schools: School[]; coordinations: Coordination[]; userId: string }) {
  const [view, setView] = useState<View>("list");
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [rotationSeconds, setRotationSeconds] = useState(AD_DEFAULT_ROTATION_SECONDS);
  const [rotationInput, setRotationInput] = useState(String(AD_DEFAULT_ROTATION_SECONDS));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const errorRetry = useLoadRetry(Boolean(error), () => setError(""));
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdCampaignDraft>(emptyDraft);
  const [imagesChanged, setImagesChanged] = useState({ desktop: false, phone: false });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [statsCampaign, setStatsCampaign] = useState<AdCampaign | null>(null);
  const [stats, setStats] = useState<AdStatsSummary | null>(null);
  const today = adDay();

  const activeSchools = useMemo(() => schools.filter((school) => school.status === "active"), [schools]);
  const schoolNames = useMemo(() => new Map(schools.map((school) => [school.id, school.name])), [schools]);
  const coordinationNames = useMemo(() => new Map(coordinations.map((coordination) => [coordination.id, coordination.name])), [coordinations]);

  useEffect(() => {
    let active = true;
    listAdCampaigns()
      .then((result) => {
        if (!active) return;
        setCampaigns(result.campaigns);
        setRotationSeconds(result.rotationSeconds);
        setRotationInput(String(result.rotationSeconds));
        setError("");
      })
      .catch((loadError) => { if (active) setError(userFacingError(loadError, "Chargement impossible.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [errorRetry.token]);

  const sorted = useMemo(() => {
    const order: Record<AdPhase, number> = { running: 0, scheduled: 1, draft: 2, stopped: 3, ended: 4 };
    return [...campaigns].sort((first, second) => order[campaignPhase(first, today)] - order[campaignPhase(second, today)] || second.startDate.localeCompare(first.startDate));
  }, [campaigns, today]);

  function targetSummary(campaign: Pick<AdCampaign, "targetMode" | "schoolIds" | "coordinationId">) {
    if (campaign.targetMode === "all") return "toutes les écoles";
    if (campaign.targetMode === "schools") return `${campaign.schoolIds.length} école(s) choisie(s)`;
    const count = activeSchools.filter((school) => school.activeCoordinationId === campaign.coordinationId).length;
    return `${coordinationNames.get(campaign.coordinationId) ?? "Coordination"} (${count} école(s))`;
  }

  function targetedSchoolCount(value: Pick<AdCampaign, "targetMode" | "schoolIds" | "coordinationId">) {
    if (value.targetMode === "all") return activeSchools.length;
    if (value.targetMode === "schools") return value.schoolIds.length;
    return activeSchools.filter((school) => school.activeCoordinationId === value.coordinationId).length;
  }

  function rolesSummary(roles: AdAudienceRole[]) {
    if (roles.length === AD_AUDIENCE_ROLES.length) return "tous";
    return roles.map((role) => AD_AUDIENCE_ROLE_LABELS[role]).join(", ") || "aucun";
  }

  function openNew() {
    setEditingId(null);
    setDraft(emptyDraft());
    setImagesChanged({ desktop: false, phone: false });
    setFormErrors([]);
    setFeedback("");
    setView("form");
  }

  async function openEdit(campaign: AdCampaign) {
    setBusy(true);
    setFeedback("");
    try {
      const images = await loadAdCampaignImages(campaign.id);
      setEditingId(campaign.id);
      setDraft({
        brand: campaign.brand,
        linkUrl: campaign.linkUrl,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        targetMode: campaign.targetMode,
        schoolIds: [...campaign.schoolIds],
        coordinationId: campaign.coordinationId,
        roles: [...campaign.roles],
        weight: campaign.weight,
        status: campaign.status,
        ...images,
      });
      setImagesChanged({ desktop: false, phone: false });
      setFormErrors([]);
      setView("form");
    } catch (openError) {
      setFeedback(userFacingError(openError, "Ouverture impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function persist(status: AdCampaign["status"]) {
    const next: AdCampaignDraft = { ...draft, brand: draft.brand.trim(), linkUrl: draft.linkUrl.trim(), status };
    const errors = validateAdCampaign(next, { publish: status === "scheduled" });
    setFormErrors(errors);
    if (errors.length > 0) return;
    setBusy(true);
    try {
      const existing = campaigns.find((campaign) => campaign.id === editingId);
      const now = new Date().toISOString();
      const campaign: AdCampaign = {
        id: existing?.id ?? newCampaignId(),
        brand: next.brand,
        linkUrl: next.linkUrl,
        startDate: next.startDate,
        endDate: next.endDate,
        targetMode: next.targetMode,
        schoolIds: next.targetMode === "schools" ? next.schoolIds : [],
        coordinationId: next.targetMode === "coordination" ? next.coordinationId : "",
        roles: next.roles,
        weight: next.weight,
        status,
        desktopVersion: existing?.desktopVersion ?? "",
        phoneVersion: existing?.phoneVersion ?? "",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        updatedBy: userId,
      };
      const updated = await saveAdCampaign({
        campaign,
        desktopImage: !existing || imagesChanged.desktop ? next.desktopImage : undefined,
        phoneImage: !existing || imagesChanged.phone ? next.phoneImage : undefined,
        allCampaigns: campaigns,
        rotationSeconds,
      });
      setCampaigns(updated);
      setFeedback(status === "scheduled" ? `Campagne « ${campaign.brand} » programmée.` : `Brouillon « ${campaign.brand} » enregistré.`);
      setView("list");
    } catch (saveError) {
      setFormErrors([userFacingError(saveError, "Enregistrement impossible.")]);
    } finally {
      setBusy(false);
    }
  }

  async function stopNow(campaign: AdCampaign) {
    if (!window.confirm(`Arrêter maintenant la campagne « ${campaign.brand} » ? L'en-tête normal revient sur les appareils dans l'heure.`)) return;
    setBusy(true);
    try {
      const updated = await saveAdCampaign({ campaign: { ...campaign, status: "stopped", updatedBy: userId }, allCampaigns: campaigns, rotationSeconds });
      setCampaigns(updated);
      setFeedback(`Campagne « ${campaign.brand} » arrêtée.`);
    } catch (stopError) {
      setFeedback(userFacingError(stopError, "Arrêt impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(campaign: AdCampaign) {
    if (!window.confirm(`Supprimer la campagne « ${campaign.brand} » ? Cette action est définitive.`)) return;
    setBusy(true);
    try {
      setCampaigns(await deleteAdCampaign({ campaignId: campaign.id, allCampaigns: campaigns, rotationSeconds }));
      setFeedback(`Campagne « ${campaign.brand} » supprimée.`);
    } catch (removeError) {
      setFeedback(userFacingError(removeError, "Suppression impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function saveRotation() {
    const value = Number(rotationInput);
    if (!Number.isFinite(value) || value < AD_MIN_ROTATION_SECONDS || value > AD_MAX_ROTATION_SECONDS) {
      setFeedback(`La durée doit être comprise entre ${AD_MIN_ROTATION_SECONDS} et ${AD_MAX_ROTATION_SECONDS} secondes.`);
      return;
    }
    setBusy(true);
    try {
      const settings = await saveAdRotationSeconds({ rotationSeconds: clampRotationSeconds(value), allCampaigns: campaigns });
      setRotationSeconds(settings.rotationSeconds);
      setRotationInput(String(settings.rotationSeconds));
      setFeedback(`Les bannières changent maintenant toutes les ${settings.rotationSeconds} secondes.`);
    } catch (rotationError) {
      setFeedback(userFacingError(rotationError, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function openStats(campaign: AdCampaign) {
    setStatsCampaign(campaign);
    setStats(null);
    setView("stats");
    try {
      setStats(summarizeAdStats(await loadAdStatsDocuments(campaign.id)));
    } catch (statsError) {
      setFeedback(userFacingError(statsError, "Statistiques indisponibles."));
    }
  }

  const tabs: Array<{ id: View; label: string }> = [
    { id: "list", label: "Campagnes" },
    { id: "form", label: editingId ? "Modifier" : "Nouvelle campagne" },
    { id: "stats", label: "Statistiques" },
  ];

  const filteredSchools = useMemo(() => {
    const search = schoolSearch.trim().toLowerCase();
    if (!search) return [];
    return activeSchools
      .filter((school) => !draft.schoolIds.includes(school.id) && `${school.name} ${school.acronym ?? ""}`.toLowerCase().includes(search))
      .slice(0, 8);
  }, [activeSchools, draft.schoolIds, schoolSearch]);

  return (
    <div className="grid min-w-0 gap-4" data-testid="ad-campaigns-drawer">
      <div className="flex flex-wrap gap-1 rounded bg-slate-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            disabled={tab.id === "stats" && !statsCampaign}
            onClick={() => (tab.id === "form" && view !== "form" ? openNew() : setView(tab.id))}
            className={`min-w-[110px] flex-1 rounded px-2 py-1.5 text-sm font-bold transition disabled:opacity-40 ${view === tab.id ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {feedback && <p role="status" className="rounded border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">{feedback}</p>}
      <ErrorNotice error={error} onRetry={errorRetry.retry} />

      {view === "list" && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500">{loading ? "Chargement…" : `${campaigns.length} campagne(s). Plusieurs campagnes sur la même école tournent dans la bannière.`}</p>
            <button type="button" className="primary-button" onClick={openNew} disabled={busy}>Nouvelle campagne</button>
          </div>

          <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3">
            <label className="text-sm font-bold text-ink" htmlFor="ad-rotation-seconds">Changement de bannière toutes les</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="ad-rotation-seconds" type="number" min={AD_MIN_ROTATION_SECONDS} max={AD_MAX_ROTATION_SECONDS} className="input w-24" value={rotationInput} onChange={(event) => setRotationInput(event.target.value)} />
              <span className="text-sm text-slate-600">secondes (minimum {AD_MIN_ROTATION_SECONDS}), avec un fondu doux.</span>
              <button type="button" className="secondary-button" onClick={() => void saveRotation()} disabled={busy || Number(rotationInput) === rotationSeconds}>Enregistrer</button>
            </div>
          </div>

          {sorted.map((campaign) => {
            const phase = campaignPhase(campaign, today);
            return (
              <article key={campaign.id} className="grid gap-2 rounded border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="min-w-0 break-words font-bold text-ink">{campaign.brand || "Sans nom"}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${phaseTone[phase]}`}>{AD_PHASE_LABELS[phase]}</span>
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>{campaign.startDate ? `Du ${formatAdDay(campaign.startDate)} au ${formatAdDay(campaign.endDate)}` : "Dates non fixées"}</span>
                  <span>Cible : <b className="text-ink">{targetSummary(campaign)}</b></span>
                  <span>Rôles : <b className="text-ink">{rolesSummary(campaign.roles)}</b></span>
                  <span>Part d'affichage : <b className="text-ink">{campaign.weight}</b></span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {(phase === "running" || phase === "ended" || phase === "stopped") && <button type="button" className="secondary-button" onClick={() => void openStats(campaign)} disabled={busy}>Statistiques</button>}
                  {phase !== "ended" && <button type="button" className="secondary-button" onClick={() => void openEdit(campaign)} disabled={busy}>Modifier</button>}
                  {(phase === "running" || phase === "scheduled") && <button type="button" className="secondary-button text-red-700" onClick={() => void stopNow(campaign)} disabled={busy}>Arrêter maintenant</button>}
                  {(phase === "draft" || phase === "scheduled") && <button type="button" className="secondary-button text-red-700" onClick={() => void remove(campaign)} disabled={busy}>Supprimer</button>}
                </div>
              </article>
            );
          })}
          {!loading && campaigns.length === 0 && <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">Aucune campagne pour le moment.</p>}
        </div>
      )}

      {view === "form" && (
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void persist("scheduled"); }}>
          <label className="grid gap-1 text-sm font-medium text-slate-700">Marque
            <input className="input" value={draft.brand} maxLength={60} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">Lien du clic (https://…)
            <input className="input" type="url" value={draft.linkUrl} placeholder="https://" onChange={(event) => setDraft({ ...draft, linkUrl: event.target.value })} />
            <span className="text-xs text-slate-500">S'ouvre dans un nouvel onglet : l'utilisateur ne quitte pas Acadéa.</span>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <ImageUploadField label={`Image ordinateur (${AD_DESKTOP_IMAGE.width} × ${AD_DESKTOP_IMAGE.height} px conseillé)`} value={draft.desktopImage} maxWidth={AD_DESKTOP_IMAGE.width} maxBytes={AD_DESKTOP_IMAGE.maxBytes} previewFit="contain" onChange={(value) => { setDraft((current) => ({ ...current, desktopImage: value })); setImagesChanged((current) => ({ ...current, desktop: true })); }} />
              <span className="text-xs text-slate-500">Allégée automatiquement : {Math.round(AD_DESKTOP_IMAGE.maxBytes / 1000)} Ko maximum.</span>
            </div>
            <div className="grid gap-1">
              <ImageUploadField label={`Image téléphone (${AD_PHONE_IMAGE.width} × ${AD_PHONE_IMAGE.height} px conseillé)`} value={draft.phoneImage} maxWidth={AD_PHONE_IMAGE.width} maxBytes={AD_PHONE_IMAGE.maxBytes} previewFit="contain" onChange={(value) => { setDraft((current) => ({ ...current, phoneImage: value })); setImagesChanged((current) => ({ ...current, phone: true })); }} />
              <span className="text-xs text-slate-500">Allégée automatiquement : {Math.round(AD_PHONE_IMAGE.maxBytes / 1000)} Ko maximum.</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-slate-700">Début
              <input className="input" type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">Fin (incluse)
              <input className="input" type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
            </label>
          </div>
          <p className="-mt-2 text-xs font-semibold text-slate-600">Dates à l'heure de Kinshasa pour toutes les écoles. La bannière commence le jour de début à 00 h 00 et disparaît le lendemain de la date de fin à 00 h 00 ; l'en-tête de l'école revient seul.</p>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-bold text-ink">Écoles visées</legend>
            {([
              ["all", "Toutes les écoles", "Écoles actives uniquement."],
              ["schools", "Certaines écoles", "Recherche par nom ou sigle, puis ajout une à une."],
              ["coordination", "Une Coordination", "Toutes les écoles rattachées, y compris celles ajoutées pendant la campagne."],
            ] as Array<[AdTargetMode, string, string]>).map(([mode, label, help]) => (
              <label key={mode} className={`flex cursor-pointer gap-3 rounded border p-3 text-sm ${draft.targetMode === mode ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}>
                <input type="radio" name="ad-target" checked={draft.targetMode === mode} onChange={() => setDraft({ ...draft, targetMode: mode })} />
                <span><b className="text-ink">{label}</b><br /><span className="text-xs text-slate-500">{help}</span></span>
              </label>
            ))}
          </fieldset>

          {draft.targetMode === "schools" && (
            <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3">
              <input className="input" placeholder="Rechercher une école (nom ou sigle)…" value={schoolSearch} onChange={(event) => setSchoolSearch(event.target.value)} />
              {filteredSchools.length > 0 && (
                <div className="grid gap-1">
                  {filteredSchools.map((school) => (
                    <button key={school.id} type="button" className="rounded border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-blue-50" onClick={() => { setDraft({ ...draft, schoolIds: [...draft.schoolIds, school.id] }); setSchoolSearch(""); }}>
                      + {school.name}{school.acronym ? ` (${school.acronym})` : ""}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {draft.schoolIds.map((schoolId) => (
                  <button key={schoolId} type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold" onClick={() => setDraft({ ...draft, schoolIds: draft.schoolIds.filter((id) => id !== schoolId) })} aria-label={`Retirer ${schoolNames.get(schoolId) ?? schoolId}`}>
                    {schoolNames.get(schoolId) ?? schoolId} ✕
                  </button>
                ))}
              </div>
            </div>
          )}

          {draft.targetMode === "coordination" && (
            <select className="input" value={draft.coordinationId} onChange={(event) => setDraft({ ...draft, coordinationId: event.target.value })} aria-label="Coordination visée">
              <option value="">Choisir une Coordination…</option>
              {coordinations.filter((coordination) => coordination.status === "active").map((coordination) => (
                <option key={coordination.id} value={coordination.id}>
                  {coordination.name} — {activeSchools.filter((school) => school.activeCoordinationId === coordination.id).length} école(s)
                </option>
              ))}
            </select>
          )}

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-bold text-ink">Rôles qui voient la bannière</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {AD_AUDIENCE_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={draft.roles.includes(role)} onChange={(event) => setDraft({ ...draft, roles: event.target.checked ? [...draft.roles, role] : draft.roles.filter((value) => value !== role) })} />
                  {AD_AUDIENCE_ROLE_LABELS[role]}
                </label>
              ))}
            </div>
            <span className="text-xs text-slate-500">« Coordination » : la bannière s'affiche aux coordinateurs seulement si cette case est cochée.</span>
          </fieldset>

          <label className="grid gap-1 text-sm font-medium text-slate-700">Part d'affichage
            <input className="input w-24" type="number" min={1} max={AD_MAX_WEIGHT} value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: Math.round(Number(event.target.value)) || 1 })} />
            <span className="text-xs text-slate-500">1 par défaut. Une campagne à 2 s'affiche deux fois plus souvent qu'une campagne à 1 sur les mêmes écoles.</span>
          </label>

          <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <b>Résumé :</b> {numberFr(targetedSchoolCount(draft))} école(s), rôles {rolesSummary(draft.roles)}
            {draft.startDate && draft.endDate ? `, du ${formatAdDay(draft.startDate)} au ${formatAdDay(draft.endDate)} (heure de Kinshasa)` : ""}.
          </p>

          {formErrors.length > 0 && (
            <ul role="alert" className="grid gap-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {formErrors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
            <button type="button" className="secondary-button" onClick={() => setView("list")} disabled={busy}>Annuler</button>
            <button type="button" className="secondary-button" onClick={() => void persist("draft")} disabled={busy}>Enregistrer en brouillon</button>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Enregistrement…" : "Programmer la campagne"}</button>
          </div>
        </form>
      )}

      {view === "stats" && statsCampaign && (
        <div className="grid gap-3">
          <div>
            <h3 className="font-bold text-ink">{statsCampaign.brand}</h3>
            <p className="text-xs text-slate-500">Du {formatAdDay(statsCampaign.startDate)} au {formatAdDay(statsCampaign.endDate)} · chiffres arrêtés à la veille (envoi groupé une fois par jour)</p>
          </div>
          {!stats ? <p className="text-sm text-slate-500">Chargement des statistiques…</p> : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Affichages", numberFr(stats.views)],
                  ["Clics", numberFr(stats.clicks)],
                  ["Taux de clic", percent(stats.clicks, stats.views)],
                  ["Écoles touchées", `${numberFr(stats.bySchool.filter((entry) => entry.views > 0).length)} / ${numberFr(targetedSchoolCount(statsCampaign))}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-500">{label}</p>
                    <p className="text-lg font-extrabold text-ink">{value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded border border-slate-200 p-3">
                <p className="mb-2 text-sm font-bold text-ink">Par jour</p>
                {stats.byDay.length === 0 ? <p className="text-sm text-slate-500">Aucun chiffre reçu pour le moment.</p> : (
                  <div className="grid gap-1">
                    {stats.byDay.map((entry) => {
                      const max = Math.max(1, ...stats.byDay.map((item) => item.views));
                      return (
                        <div key={entry.day} className="grid grid-cols-[72px_1fr_auto] items-center gap-2 text-xs">
                          <span className="text-slate-500">{formatAdDay(entry.day).slice(0, 5)}</span>
                          <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-blue-600" style={{ width: `${(entry.views / max) * 100}%` }} /></span>
                          <span className="font-semibold text-ink">{numberFr(entry.views)} · {numberFr(entry.clicks)} clic(s)</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2 rounded border border-slate-200 p-3 text-sm">
                  <p className="font-bold text-ink">Par appareil</p>
                  <p className="flex justify-between"><span>Ordinateur</span><b>{percent(stats.byDevice.desktop.views, stats.views)}</b></p>
                  <p className="flex justify-between"><span>Téléphone</span><b>{percent(stats.byDevice.phone.views, stats.views)}</b></p>
                </div>
                <div className="grid gap-2 rounded border border-slate-200 p-3 text-sm">
                  <p className="font-bold text-ink">Par rôle (toutes écoles réunies)</p>
                  {stats.byRole.map((entry) => (
                    <p key={entry.role} className="flex justify-between"><span>{AD_AUDIENCE_ROLE_LABELS[entry.role]}</span><b>{percent(entry.views, stats.views)}</b></p>
                  ))}
                </div>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <p className="mb-2 text-sm font-bold text-ink">Écoles où la bannière est la plus vue</p>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">École</th><th className="py-1 text-right">Affichages</th><th className="py-1 text-right">Clics</th></tr></thead>
                  <tbody>
                    {stats.bySchool.slice(0, 10).map((entry) => (
                      <tr key={entry.schoolId} className="border-t border-slate-100"><td className="py-1">{schoolNames.get(entry.schoolId) ?? entry.schoolId}</td><td className="py-1 text-right">{numberFr(entry.views)}</td><td className="py-1 text-right">{numberFr(entry.clicks)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><b>Aucune donnée personnelle.</b> Seulement des totaux par jour, par école, par type d'appareil, et par rôle pour l'ensemble des écoles. Jamais de nom, de compte ni d'identifiant d'appareil.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
