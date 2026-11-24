import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { EnvironmentBanner } from "../layout/EnvironmentBanner";
import { PlatformLogoSlot } from "../layout/PlatformLogoSlot";
import { markAuthStep } from "../../utils/authPerformance";
import { userFacingError } from "../../utils/userFacingError";
import { ARCHIVED_TEACHER_LOGIN_MARKER } from "../../services/auth";
import { ErrorNotice } from "../ui/ErrorNotice";

// Textes de la proposition B : slogan sur la photo et 4 avantages.
const LOGIN_SLOGAN = "La gestion scolaire dans ma poche";
const LOGIN_ADVANTAGES = [
  "Paiements et reçus en quelques secondes",
  "Suivi des élèves, des présences et des dettes",
  "Répartition des frais claire et transparente",
  "Parents, enseignants et direction connectés",
];
// Photo : Katerina Holmes, Pexels (licence Pexels, usage commercial permis), 84 Ko.
const LOGIN_PHOTO_SRC = "/connexion-enseignante.jpg";
const LOGIN_PHOTO_CREDIT = "Photo : Katerina Holmes · Pexels";

export function LoginScreen({
  onLogin,
  onDismissError,
  initialError,
  platformLogoUrl,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  onDismissError?: () => void;
  initialError?: string;
  platformLogoUrl: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    <main className="flex min-h-dvh w-full flex-col bg-white lg:h-dvh lg:overflow-hidden">
      <EnvironmentBanner />
      <style>{`
        @keyframes loginCardIn {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="relative h-[300px] shrink-0 overflow-hidden lg:h-auto lg:w-[55%]">
        <img
          src={LOGIN_PHOTO_SRC}
          alt="Enseignante souriante qui interroge ses élèves dans une classe lumineuse"
          className="absolute inset-0 h-full w-full object-cover object-[50%_6%] lg:object-[50%_30%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#14213d]/90 via-[#14213d]/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5 pb-10 text-white lg:p-14">
          <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight sm:text-3xl lg:text-5xl">{LOGIN_SLOGAN}</h1>
          <ul className="mt-6 hidden gap-3 text-lg lg:grid">
            {LOGIN_ADVANTAGES.map((advantage) => (
              <li key={advantage} className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-sm font-extrabold">✓</span>
                {advantage}
              </li>
            ))}
          </ul>
        </div>
        <p className="absolute right-3 top-2 text-[10px] text-white/70">{LOGIN_PHOTO_CREDIT}</p>
      </aside>
      <div className="relative -mt-6 flex flex-1 flex-col items-center justify-center rounded-t-[26px] bg-white px-4 pb-6 pt-5 lg:mt-0 lg:rounded-none lg:bg-[#F5F7FB] lg:px-10 lg:py-6">
      <section className="w-full max-w-[460px] overflow-hidden rounded-[22px] border border-white/80 bg-white p-3 shadow-[0_24px_80px_rgba(15,23,42,0.10)] [animation:loginCardIn_520ms_ease-out] sm:rounded-[24px] sm:p-6">
        <PlatformLogoSlot logoUrl={platformLogoUrl} />

        {error === ARCHIVED_TEACHER_LOGIN_MARKER ? <div className="mt-5 grid gap-4 text-center sm:mt-7">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">Accès à votre compte suspendu</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{"Votre compte Enseignant Acadéa est actuellement désactivé à la suite de son archivage par votre établissement scolaire.\n\nPour obtenir davantage d'informations ou demander la réactivation de votre compte, veuillez contacter l'administrateur de votre école.\n\nNous vous remercions de votre compréhension.\n\nL'équipe Acadéa."}</p>
          <button type="button" className="secondary-button w-full justify-center" onClick={() => { onDismissError?.(); setError(""); setEmail(""); setPassword(""); }}>Retour à la connexion</button>
        </div> : <><div className="mt-5 text-center sm:mt-7">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">Connexion</h2>
          <p className="mt-1 text-xs text-slate-500 sm:mt-2 sm:text-sm">Accédez à votre espace sécurisé</p>
        </div>

        <form onSubmit={submit} className="mt-4 grid min-w-0 gap-3 sm:mt-6 sm:gap-4">
          <label className="group grid gap-2 text-sm font-semibold text-slate-700">
            Email
            <span className="flex h-12 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-3 transition duration-200 group-focus-within:border-blue-500 group-focus-within:bg-white group-focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] sm:h-14 sm:px-4">
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

          <label className="group grid gap-2 text-sm font-semibold text-slate-700">
            Mot de passe
            <span className="flex h-12 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-3 transition duration-200 group-focus-within:border-blue-500 group-focus-within:bg-white group-focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] sm:h-14 sm:px-4">
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
            className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink font-semibold text-white shadow-[0_16px_34px_rgba(20,33,61,0.22)] transition duration-200 hover:bg-[#0f1a30] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:h-14"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-slate-500 sm:mt-5">
          <ShieldCheck className="h-4 w-4 text-mint" />
          Espace sécurisé
        </div>
        </>}
      </section>
      <ul className="mt-4 grid w-full max-w-[460px] gap-1.5 text-xs text-slate-500 lg:hidden">
        {LOGIN_ADVANTAGES.map((advantage) => (
          <li key={advantage} className="flex items-start gap-2">
            <span aria-hidden="true" className="font-extrabold text-emerald-500">✓</span>
            {advantage}
          </li>
        ))}
      </ul>
      </div>
      </div>
    </main>
  );
}
