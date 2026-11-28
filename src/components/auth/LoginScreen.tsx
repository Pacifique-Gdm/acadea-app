import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { EnvironmentBanner } from "../layout/EnvironmentBanner";
import { PlatformLogoSlot } from "../layout/PlatformLogoSlot";
import { markAuthStep } from "../../utils/authPerformance";
import { userFacingError } from "../../utils/userFacingError";
import { ARCHIVED_TEACHER_LOGIN_MARKER } from "../../services/auth";
import { ErrorNotice } from "../ui/ErrorNotice";

// Textes de la proposition B : slogan sur la photo et 4 avantages.
export const LOGIN_SLOGAN = "La gestion scolaire dans ma poche";
const LOGIN_ADVANTAGES = [
  "Paiements et reçus en quelques secondes",
  "Suivi des élèves, des présences et des dettes",
  "Répartition des frais claire et transparente",
  "Parents, enseignants et direction connectés",
];
// Photo : Katerina Holmes, Pexels (licence Pexels, usage commercial permis), 84 Ko.
export const LOGIN_PHOTO_SRC = "/connexion-enseignante.jpg";
// Téléphone (maquette validée le 25/11/2026) : avantages courts, animés sur la photo.
const LOGIN_ADVANTAGES_PHONE = [
  "Paiements et reçus en quelques secondes",
  "Suivi des élèves, présences et dettes",
  "Répartition des frais transparente",
  "Parents, enseignants et direction connectés",
];
// Animations de la photo (téléphone et ordinateur) : zoom doux et apparition des avantages en boucle.
const LOGIN_PHOTO_ANIMATIONS = `
  @keyframes loginPhotoZoom { from { transform: scale(1); } to { transform: scale(1.1); } }
  @keyframes loginAdvantageCycle {
    0% { opacity: 0; transform: translateY(6px); }
    7% { opacity: 1; transform: none; }
    82% { opacity: 1; transform: none; }
    92% { opacity: 0; transform: translateY(-3px); }
    100% { opacity: 0; }
  }
  .login-photo-zoom { animation: loginPhotoZoom 4s ease-in-out infinite alternate; will-change: transform; }
  .login-advantage { opacity: 0; animation: loginAdvantageCycle 6s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .login-photo-zoom { animation: none; }
    .login-advantage { animation: none; opacity: 1; }
  }
`;
const advantageDelay = (index: number) => ({ animationDelay: `${index * 0.4}s` });
// Téléphone : voile de la maquette (fondu blanc en bas, léger dégradé sombre, teinte bleue).
export const PHONE_PHOTO_VEIL = "linear-gradient(180deg,rgba(255,255,255,0) calc(100% - 26px),#fff 100%),linear-gradient(180deg,rgba(20,33,61,0) 45%,rgba(20,33,61,.42) 85%),rgba(30,58,138,.16)";

// ===== Fond flou (maquette « flou léger » validée le 28/11/2026) =====
// Derrière le formulaire : une petite copie floue de la photo, préparée UNE SEULE FOIS (au choix de l'image
// par le Super administrateur ; fichier fixe ci-dessous pour l'image d'origine), affichée telle quelle.
// Sans copie floue (anciennes images) ou si elle ne se charge pas : l'écran d'aujourd'hui, sans changement.
export const LOGIN_PHOTO_BLUR_SRC = "/connexion-enseignante-flou.jpg";
/** Copie floue à afficher : fichier fixe pour l'image d'origine, sinon celle enregistrée avec l'image (ou rien). */
export function loginBackgroundBlurSrc(loginImageUrl: string, loginImageBlurUrl: string) {
  return loginImageUrl ? loginImageBlurUrl : LOGIN_PHOTO_BLUR_SRC;
}
const withMask = (mask: string): CSSProperties => ({ WebkitMaskImage: mask, maskImage: mask });
// Ordinateur (aucun miroir) : la photo nette s'efface directement sur ses 220 derniers points dans la copie floue.
export const DESKTOP_PHOTO_FADE_MASK = "linear-gradient(to right,#000 calc(100% - 220px),transparent)";
// Le dégradé sombre du bas continue un peu sous le flou, puis s'efface (pas de bord net à la jonction).
const DESKTOP_DARK_BRIDGE_MASK = "linear-gradient(to right,transparent calc(55% - 220px),#000 calc(55% - 60px),transparent calc(55% + 160px))";
// Ordinateur : voile blanc très léger derrière le formulaire, sans bord net.
export const DESKTOP_BLUR_VEIL = "radial-gradient(ellipse 420px 520px at 77.5% 50%,rgba(255,255,255,.5),rgba(255,255,255,0)),linear-gradient(90deg,rgba(255,255,255,0) 55%,rgba(255,255,255,.16) 73%)";
// Téléphone : même voile sombre qu'aujourd'hui pour les ✓, sans le fondu blanc (la photo se fond dans le flou).
export const PHONE_PHOTO_VEIL_BLUR = "linear-gradient(180deg,rgba(20,33,61,0) 30%,rgba(20,33,61,.55) 72%,rgba(20,33,61,.6) 100%),rgba(30,58,138,.12)";
// Téléphone (rien n'est retourné) : le bas de la photo nette s'efface sur 96 points dans sa copie floue posée
// exactement au même endroit, qui s'efface à son tour sur 56 points dans la même photo entière en flou léger,
// à l'endroit, placée dessous. Seulement sur téléphone (sur ordinateur, la photo n'est pas touchée).
export const PHONE_PHOTO_FADE_MASK = "linear-gradient(to bottom,#000 calc(100% - 96px),transparent)";
export const PHONE_BLUR_FADE_MASK = "linear-gradient(to bottom,#000 calc(100% - 56px),transparent)";
const LOGIN_BLUR_STYLES = `
  @media (min-width: 1024px) {
    .login-photo-fade-desktop { -webkit-mask-image: ${DESKTOP_PHOTO_FADE_MASK}; mask-image: ${DESKTOP_PHOTO_FADE_MASK}; }
  }
  @media (max-width: 1023.98px) {
    .login-photo-fade { -webkit-mask-image: ${PHONE_PHOTO_FADE_MASK}; mask-image: ${PHONE_PHOTO_FADE_MASK}; }
    .login-blur-fade { -webkit-mask-image: ${PHONE_BLUR_FADE_MASK}; mask-image: ${PHONE_BLUR_FADE_MASK}; }
  }
`;
// Téléphone : voile blanc léger derrière le formulaire (la photo floue reste bien visible).
export const PHONE_BLUR_VEIL = "linear-gradient(180deg,rgba(255,255,255,0) 0,rgba(255,255,255,0) 60px,rgba(255,255,255,.2) 160px,rgba(255,255,255,.26))";

export function LoginScreen({
  onLogin,
  onDismissError,
  initialError,
  platformLogoUrl,
  loginImageUrl = "",
  loginImageBlurUrl = "",
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  onDismissError?: () => void;
  initialError?: string;
  platformLogoUrl: string;
  /** Lot 9 : image choisie par le Super administrateur ; vide = photo d'origine, rien ne change. */
  loginImageUrl?: string;
  /** Fond flou : copie floue enregistrée avec l'image choisie ; vide = fond d'aujourd'hui pour cette image. */
  loginImageBlurUrl?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const blurSrc = loginBackgroundBlurSrc(loginImageUrl, loginImageBlurUrl);
  const [blurFailed, setBlurFailed] = useState(false);
  useEffect(() => setBlurFailed(false), [blurSrc]);
  // Fond flou seulement si la copie floue existe et se charge ; sinon l'écran d'aujourd'hui.
  const blurred = Boolean(blurSrc) && !blurFailed;
  const onBlurError = () => setBlurFailed(true);

  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;
    const previousContent = viewport.content;
    viewport.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
    return () => {
      viewport.content = previousContent;
    };
  }, []);

  useEffect(() => {
    setError(initialError ?? "");
  }, [initialError]);

  function formatLoginError(loginError: unknown) {
    // Texte brut lu pour reconnaître le cas, jamais affiché tel quel.
    const message = loginError instanceof Error ? String(loginError.message) : String(loginError);
    if (message.includes(ARCHIVED_TEACHER_LOGIN_MARKER)) return ARCHIVED_TEACHER_LOGIN_MARKER;
    if (message.includes("auth/user-disabled") || message.includes("n’est plus actif") || message.includes("n'est plus actif")) {
      return "Votre compte n’est plus actif dans cet établissement.";
    }
    if (message.includes("auth/invalid-credential") || message.includes("auth/user-not-found") || message.includes("auth/wrong-password")) {
      return "Email ou mot de passe incorrect.";
    }
    if (message.includes("auth/too-many-requests")) {
      return "Trop de tentatives de connexion. Réessayez plus tard.";
    }
    if (message.includes("auth/network-request-failed")) return userFacingError(loginError, "Connexion impossible.");
    return "Email ou mot de passe incorrect.";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    markAuthStep("auth:login-start");
    setError("");
    setLoading(true);

    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(formatLoginError(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-white lg:h-dvh lg:overflow-hidden">
      <EnvironmentBanner />
      <style>{`
        @keyframes loginCardIn {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}{LOGIN_PHOTO_ANIMATIONS}{LOGIN_BLUR_STYLES}</style>
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
      {blurred && (
        // Ordinateur (aucun miroir, aucun étirement) : toute la copie floue couvre le fond sur toute la largeur
        // (object-fit: cover), sous la photo nette, qui s'y efface directement par un fondu long.
        <div aria-hidden="true" data-testid="login-blur-desktop" className="pointer-events-none absolute inset-0 hidden overflow-hidden bg-[#F5F7FB] lg:block">
          <img src={blurSrc} alt="" onError={onBlurError} className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#14213d]/90 via-[#14213d]/45 to-transparent" style={withMask(DESKTOP_DARK_BRIDGE_MASK)} />
          <div className="absolute inset-0" style={{ background: DESKTOP_BLUR_VEIL }} />
        </div>
      )}
      <aside className={`relative min-h-[120px] flex-[0_1_50%] overflow-hidden [border-radius:0_0_50%_50%/0_0_22px_22px] lg:h-auto lg:w-[55%] lg:flex-none lg:rounded-none${blurred ? " z-[1] max-lg:overflow-visible max-lg:[border-radius:0]" : ""}`}>
        {blurred && (
          // Téléphone : dessous, la même photo entière en flou léger, À L'ENDROIT (jusqu'en bas de l'écran), avec un voile blanc léger ;
          // par-dessus, la copie floue au même endroit que la photo nette, qui s'efface doucement sur elle.
          <>
            <div aria-hidden="true" data-testid="login-blur-phone" className="pointer-events-none absolute inset-x-0 top-[calc(100%-56px)] h-[calc(100dvh-100%+56px)] overflow-hidden bg-[#F5F7FB] lg:hidden">
              <img src={blurSrc} alt="" onError={onBlurError} className="absolute inset-0 h-full w-full object-cover object-[50%_50%]" />
              <div className="absolute inset-0" style={{ background: PHONE_BLUR_VEIL }} />
            </div>
            <div aria-hidden="true" data-testid="login-blur-phone-under-photo" className="login-blur-fade pointer-events-none absolute inset-0 overflow-hidden lg:hidden">
              <img src={blurSrc} alt="" onError={onBlurError} className="absolute inset-0 h-full w-full object-cover object-[50%_45%]" />
            </div>
          </>
        )}
        <div className={`absolute inset-0 overflow-hidden${blurred ? " login-photo-fade login-photo-fade-desktop" : ""}`}>
        <img
          src={loginImageUrl || LOGIN_PHOTO_SRC}
          alt={loginImageUrl ? "Image de l'écran de connexion" : "Enseignante souriante qui interroge ses élèves dans une classe lumineuse"}
          className="login-photo-zoom absolute inset-0 h-full w-full origin-[50%_60%] object-cover object-[50%_45%] lg:origin-[50%_40%] lg:object-[50%_30%]"
        />
        </div>
        <div className={`absolute inset-0 hidden bg-gradient-to-t from-[#14213d]/30 via-transparent to-transparent lg:from-[#14213d]/90 lg:via-[#14213d]/45 lg:block${blurred ? " login-photo-fade-desktop" : ""}`} />
        <div aria-hidden="true" className={`absolute inset-0 lg:hidden${blurred ? " login-photo-fade" : ""}`} style={{ background: blurred ? PHONE_PHOTO_VEIL_BLUR : PHONE_PHOTO_VEIL }} />
        {blurred && <p aria-hidden="true" className="absolute inset-x-4 bottom-[140px] text-[21px] font-extrabold leading-tight tracking-tight text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.5)] lg:hidden">{LOGIN_SLOGAN}</p>}
        <ul className={`absolute inset-x-0 bottom-0 grid gap-[3px] px-4 ${blurred ? "pb-[64px]" : "pb-6"} text-[12.5px] leading-tight text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.65)] lg:hidden`}>
          {LOGIN_ADVANTAGES_PHONE.map((advantage, index) => (
            <li key={advantage} className="login-advantage flex gap-[7px] whitespace-nowrap" style={advantageDelay(index)}>
              <span aria-hidden="true" className="font-extrabold text-emerald-300">✓</span>
              {advantage}
            </li>
          ))}
        </ul>
        <div className="absolute inset-x-0 bottom-0 hidden p-5 pb-10 text-white lg:block lg:p-14">
          <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight sm:text-3xl lg:text-5xl">{LOGIN_SLOGAN}</h1>
          <ul className="mt-6 hidden gap-3 text-lg lg:grid">
            {LOGIN_ADVANTAGES.map((advantage, index) => (
              <li key={advantage} className="login-advantage flex items-start gap-3" style={advantageDelay(index)}>
                <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-sm font-extrabold">✓</span>
                {advantage}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      {/* Téléphone : le slogan est déjà dans le logo ; ce titre reste seulement pour les lecteurs d'écran. */}
      <h1 className="sr-only lg:hidden">{LOGIN_SLOGAN}</h1>
      <div className={`relative flex min-h-0 flex-1 basis-0 flex-col items-center justify-center overflow-y-auto ${blurred ? "bg-transparent px-4 py-3.5 max-lg:-mt-[62px]" : "bg-white px-5 py-2"} lg:mt-0 lg:basis-auto lg:overflow-visible lg:rounded-none ${blurred ? "" : "lg:bg-[#F5F7FB] "}lg:px-10 lg:py-6`}>
      <section className={`flex w-full max-w-[460px] flex-1 flex-col justify-evenly gap-1 bg-white [animation:loginCardIn_520ms_ease-out] lg:block lg:flex-none lg:overflow-hidden lg:rounded-[24px] lg:border lg:border-white/80 lg:p-6 lg:shadow-[0_24px_80px_rgba(15,23,42,0.10)]${blurred ? " relative z-[2] rounded-[24px] border border-white/80 px-4 py-3.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)]" : ""}`}>
        <div className="max-lg:[&>div]:min-h-0 max-lg:[@media(max-height:800px)]:[&_img]:max-h-16 max-lg:[@media(max-height:700px)]:[&_img]:max-h-12">
          <PlatformLogoSlot logoUrl={platformLogoUrl} shadow={false} />
        </div>

        {error === ARCHIVED_TEACHER_LOGIN_MARKER ? <div className="mt-5 grid gap-4 text-center sm:mt-7">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">Accès à votre compte suspendu</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{"Votre compte Enseignant Acadéa est actuellement désactivé à la suite de son archivage par votre établissement scolaire.\n\nPour obtenir davantage d'informations ou demander la réactivation de votre compte, veuillez contacter l'administrateur de votre école.\n\nNous vous remercions de votre compréhension.\n\nL'équipe Acadéa."}</p>
          <button type="button" className="secondary-button w-full justify-center" onClick={() => { onDismissError?.(); setError(""); setEmail(""); setPassword(""); }}>Retour à la connexion</button>
        </div> : <><div className="hidden text-center lg:mt-7 lg:block">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">Connexion</h2>
          <p className="mt-1 text-xs text-slate-500 sm:mt-2 sm:text-sm">Accédez à votre espace sécurisé</p>
        </div>

        <form onSubmit={submit} className="grid min-w-0 gap-2 lg:mt-6 lg:gap-4">
          <label className="group grid gap-1 text-[13px] font-semibold text-slate-700 lg:gap-2 lg:text-sm">
            Email
            <span className="flex h-11 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-3 transition duration-200 group-focus-within:border-blue-500 group-focus-within:bg-white group-focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] lg:h-14 lg:px-4">
              <Mail className="h-5 w-5 shrink-0 text-slate-400 transition group-focus-within:text-blue-600" />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-slate-400"
                placeholder="email@ecole.com"
              />
            </span>
          </label>

          <label className="group grid gap-1 text-[13px] font-semibold text-slate-700 lg:gap-2 lg:text-sm">
            Mot de passe
            <span className="flex h-11 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-3 transition duration-200 group-focus-within:border-blue-500 group-focus-within:bg-white group-focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] lg:h-14 lg:px-4">
              <Lock className="h-5 w-5 shrink-0 text-slate-400 transition group-focus-within:text-blue-600" />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                required
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-slate-400"
                placeholder="Votre mot de passe"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-ink"
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </span>
          </label>

          <ErrorNotice error={error} />

          <button
            disabled={loading}
            className="mt-0.5 flex h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-ink font-semibold text-white transition duration-200 hover:bg-[#0f1a30] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 lg:mt-1 lg:h-14 lg:shadow-[0_16px_34px_rgba(20,33,61,0.22)]"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-slate-500 lg:mt-5 lg:text-sm">
          <ShieldCheck className="h-4 w-4 text-mint" />
          Espace sécurisé
        </div>
        </>}
      </section>
      </div>
      </div>
    </main>
  );
}
