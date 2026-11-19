import { AD_FADE_MS, type HeaderAdState } from "../../hooks/useHeaderAd";


/** Bannière marquée « Publicité ». Le clic ouvre le lien dans un nouvel onglet. */
export function HeaderAdBanner({ ad }: { ad: NonNullable<HeaderAdState> }) {
  const label = ad.campaign.brand ? `Publicité : ${ad.campaign.brand}` : "Publicité";
  return (
    <a
      href={ad.campaign.linkUrl}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={ad.onClick}
      data-testid="header-ad-banner"
      aria-label={`${label} (s'ouvre dans un nouvel onglet)`}
      className="relative block overflow-hidden rounded border border-slate-200 bg-slate-100 print:hidden"
      style={{ opacity: ad.fading ? 0 : 1, transition: `opacity ${AD_FADE_MS}ms ease` }}
    >
      <img
        src={ad.imageUrl}
        alt={label}
        className={`block w-full object-cover ${ad.device === "phone" ? "aspect-[3/1]" : "aspect-[8/1] max-h-[150px]"}`}
      />
      <span className="absolute left-1.5 top-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-700">Publicité</span>
    </a>
  );
}
