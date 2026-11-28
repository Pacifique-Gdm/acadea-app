import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { CheckCircle2, ImagePlus, RotateCcw } from "lucide-react";
import { LOGIN_PHOTO_SRC, LOGIN_SLOGAN, PHONE_PHOTO_VEIL } from "../auth/LoginScreen";
import { ErrorNotice } from "../ui/ErrorNotice";
import { userFacingError } from "../../utils/userFacingError";
import {
  compressLoginImageFile,
  LOGIN_IMAGE_RESET_CONFIRMATION,
  LOGIN_IMAGE_SAVE_CONFIRMATION,
  loadLoginImage,
  saveLoginImage,
} from "../../services/loginImage";

type Draft = { dataUrl: string; bytes: number; blurDataUrl: string };
type Pending = "save" | "reset" | null;

/** Aperçu ordinateur : photo à gauche (55 %), carte de connexion à droite, comme le vrai écran. */
export function LoginImageDesktopPreview({ imageUrl, logoUrl }: { imageUrl: string; logoUrl: string }) {
  return (
    <figure className="grid gap-1">
      <div data-testid="login-preview-desktop" className="flex aspect-[16/10] w-full overflow-hidden rounded-lg border-4 border-slate-800 bg-white shadow">
        <div className="relative w-[55%] overflow-hidden">
          <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#14213d]/90 via-[#14213d]/45 to-transparent" />
          <p className="absolute inset-x-0 bottom-0 p-2 text-[9px] font-extrabold leading-tight text-white sm:text-[11px]">{LOGIN_SLOGAN}</p>
        </div>
        <div className="flex flex-1 items-center justify-center bg-[#F5F7FB] p-2">
          <div className="grid w-full gap-1 rounded-md bg-white p-2 shadow">
            <img src={logoUrl || "/acadea-icon.png"} alt="" className="mx-auto h-4 w-auto object-contain" />
            <span className="h-2 rounded bg-slate-100" />
            <span className="h-2 rounded bg-slate-100" />
            <span className="h-2 rounded bg-ink" />
          </div>
        </div>
      </div>
      <figcaption className="text-center text-xs font-semibold text-slate-500">Ordinateur</figcaption>
    </figure>
  );
}

/** Aperçu téléphone : photo en haut (moitié de l'écran, bas arrondi), formulaire dessous. */
export function LoginImagePhonePreview({ imageUrl, logoUrl }: { imageUrl: string; logoUrl: string }) {
  return (
    <figure className="grid justify-items-center gap-1">
      <div data-testid="login-preview-phone" className="flex aspect-[9/19] w-[120px] flex-col overflow-hidden rounded-[18px] border-4 border-slate-800 bg-white shadow">
        <div className="relative flex-[0_1_50%] overflow-hidden [border-radius:0_0_50%_50%/0_0_10px_10px]">
          <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_45%]" />
          <div className="absolute inset-0" style={{ background: PHONE_PHOTO_VEIL }} />
        </div>
        <div className="grid flex-1 content-evenly gap-1 px-2">
          <img src={logoUrl || "/acadea-icon.png"} alt="" className="mx-auto h-5 w-auto object-contain" />
          <span className="h-2 rounded bg-slate-100" />
          <span className="h-2 rounded bg-slate-100" />
          <span className="h-2 rounded bg-ink" />
        </div>
      </div>
      <figcaption className="text-center text-xs font-semibold text-slate-500">Téléphone</figcaption>
    </figure>
  );
}

/**
 * Lot 9 : drawer « Image de connexion » du Super administrateur.
 * `refreshToken` change quand la flèche ronde de l'en-tête est touchée : l'image enregistrée est relue.
 */
export function LoginImageDrawer({ platformLogoUrl, refreshToken = 0 }: { platformLogoUrl: string; refreshToken?: number }) {
  const inputId = useId();
  const [savedImage, setSavedImage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    loadLoginImage()
      .then((image) => { if (!cancelled) setSavedImage(image.imageDataUrl); })
      .catch((loadFailure) => { if (!cancelled) setLoadError(userFacingError(loadFailure, "Image de connexion indisponible.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshToken]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setMessage("");
    setPending(null);
    setCompressing(true);
    try {
      setDraft(await compressLoginImageFile(file));
    } catch (compressFailure) {
      setError(userFacingError(compressFailure, "Image impossible à traiter."));
    } finally {
      setCompressing(false);
    }
  }

  async function confirm() {
    if (!pending || savingRef.current) return;
    if (pending === "save" && !draft) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const image = pending === "save"
        ? await saveLoginImage(draft!.dataUrl, LOGIN_IMAGE_SAVE_CONFIRMATION, draft!.blurDataUrl)
        : await saveLoginImage("", LOGIN_IMAGE_RESET_CONFIRMATION);
      setSavedImage(image.imageDataUrl);
      setDraft(null);
      setMessage(pending === "save" ? "Nouvelle image enregistrée. Elle apparaît sur l'écran de connexion de tous les appareils en quelques minutes." : "Image d'origine rétablie sur l'écran de connexion.");
      setPending(null);
    } catch (saveFailure) {
      setError(userFacingError(saveFailure, "Enregistrement de l'image impossible."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const previewImage = draft?.dataUrl || savedImage || LOGIN_PHOTO_SRC;
  const previewLabel = draft ? "Aperçu de la nouvelle image (pas encore enregistrée)" : savedImage ? "Image actuelle de l'écran de connexion" : "Image d'origine de l'écran de connexion";

  return (
    <div className="grid min-w-0 gap-4">
      <ErrorNotice error={loadError} />
      <section aria-label="Aperçu de l'écran de connexion" className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-700">{loading ? "Chargement de l'image actuelle…" : previewLabel}</p>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <LoginImageDesktopPreview imageUrl={previewImage} logoUrl={platformLogoUrl} />
          <LoginImagePhonePreview imageUrl={previewImage} logoUrl={platformLogoUrl} />
        </div>
        {draft && <p className="text-xs font-medium text-slate-500">Poids après compression : {Math.max(1, Math.round(draft.bytes / 1024))} Ko (100 Ko maximum).</p>}
      </section>

      <div className="grid gap-2">
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} disabled={compressing || saving} className="sr-only" />
        <label htmlFor={inputId} className={`secondary-button w-full cursor-pointer justify-center ${compressing || saving ? "pointer-events-none opacity-60" : ""}`}>
          <ImagePlus className="h-4 w-4" /> {compressing ? "Compression…" : draft ? "Choisir une autre image" : "Choisir une image"}
        </label>
        <p className="text-xs font-medium text-slate-500">JPG, PNG ou WEBP. L'image est réduite automatiquement sous 100 Ko.</p>
      </div>

      {message && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{message}</p>}
      <ErrorNotice error={error} />

      {pending && (
        <div role="group" aria-label="Confirmer le changement d'image" className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            {pending === "save" ? "Remplacer l'image de l'écran de connexion pour tous les utilisateurs ?" : "Revenir à l'image d'origine pour tous les utilisateurs ?"}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="secondary-button justify-center" disabled={saving} onClick={() => setPending(null)}>Annuler</button>
            <button type="button" className="primary-button justify-center disabled:opacity-50" disabled={saving} onClick={() => void confirm()}>{saving ? "Enregistrement…" : "Confirmer"}</button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <button type="button" className="primary-button w-full justify-center disabled:opacity-50" disabled={!draft || saving || compressing} onClick={() => { setPending("save"); setMessage(""); setError(""); }}>
          <CheckCircle2 className="h-4 w-4" /> Enregistrer l'image
        </button>
        {draft && (
          <button type="button" className="secondary-button w-full justify-center" disabled={saving} onClick={() => { setDraft(null); setPending(null); }}>
            Annuler le choix
          </button>
        )}
        <button type="button" className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50" disabled={!savedImage || saving || loading} onClick={() => { setPending("reset"); setMessage(""); setError(""); }}>
          <RotateCcw className="mr-1 inline h-4 w-4" /> Revenir à l'image d'origine
        </button>
      </div>
    </div>
  );
}
