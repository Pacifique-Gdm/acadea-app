import { existsSync, readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_PHOTO_FADE_MASK,
  LOGIN_PHOTO_BLUR_SRC,
  LoginScreen,
  loginBackgroundBlurSrc,
  PHONE_BLUR_FADE_MASK,
  PHONE_PHOTO_FADE_MASK,
  PHONE_PHOTO_VEIL,
} from "./LoginScreen";

// Fond flou (maquette « flou léger » validée le 28/11/2026).
const IMAGE = "data:image/webp;base64,AAAA";
const BLUR = "data:image/jpeg;base64,BBBB";
const login = (props: { loginImageUrl?: string; loginImageBlurUrl?: string } = {}) => renderToStaticMarkup(createElement(LoginScreen, {
  onLogin: async () => undefined,
  platformLogoUrl: "",
  ...props,
}));

describe("écran de connexion : fond flou tiré de la photo", () => {
  it("image d'origine : la copie floue fixe est affichée derrière le formulaire (ordinateur et téléphone)", () => {
    const html = login();
    expect(html).toContain('data-testid="login-blur-desktop"');
    expect(html).toContain('data-testid="login-blur-phone"');
    expect(html).toContain('data-testid="login-blur-phone-under-photo"');
    expect(html).toContain(`src="${LOGIN_PHOTO_BLUR_SRC}"`);
    // La photo nette reste affichée en entier.
    expect(html).toContain('src="/connexion-enseignante.jpg"');
  });

  it("la photo nette se fond dans le flou : à droite sur ordinateur, en bas sur téléphone", () => {
    const html = login();
    expect(html).toContain("login-photo-fade login-photo-fade-desktop");
    expect(html).toContain("login-blur-fade");
    // Ordinateur : la photo nette s'efface directement dans la copie floue, sur 220 points (fondu plus long).
    expect(DESKTOP_PHOTO_FADE_MASK).toBe("linear-gradient(to right,#000 calc(100% - 220px),transparent)");
    expect(PHONE_PHOTO_FADE_MASK).toBe("linear-gradient(to bottom,#000 calc(100% - 96px),transparent)");
    expect(PHONE_BLUR_FADE_MASK).toBe("linear-gradient(to bottom,#000 calc(100% - 56px),transparent)");
    // Le fondu du téléphone ne touche pas l'ordinateur.
    const source = readFileSync("src/components/auth/LoginScreen.tsx", "utf8");
    expect(source).toMatch(/@media \(max-width: 1023\.98px\) \{\r?\n\s+\.login-photo-fade/);
    // Téléphone : plus de fondu blanc ni de bord arrondi visible sous la photo.
    expect(html).not.toContain(PHONE_PHOTO_VEIL);
    expect(html).toContain("max-lg:overflow-visible max-lg:[border-radius:0]");
  });

  it("le slogan et les avantages restent sur la photo nette ; le slogan est visible sur téléphone", () => {
    const html = login();
    expect(html.match(/La gestion scolaire dans ma poche/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("bottom-[140px] text-[21px] font-extrabold");
    expect(html).toContain("pb-[64px]");
    expect(html).toContain("Paiements et reçus en quelques secondes");
  });

  it("téléphone : formulaire sur une carte blanche arrondie avec une ombre douce, voile blanc léger", () => {
    const html = login();
    expect(html).toContain("relative z-[2] rounded-[24px] border border-white/80 px-4 py-3.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)]");
    expect(html).toContain("rgba(255,255,255,.2) 160px");
  });

  it("téléphone : la carte du formulaire chevauche le bas de la photo (jonction cachée), le voile blanc commence plus bas", () => {
    const html = login();
    // La carte remonte de 62 points (48 points de chevauchement visibles, après la marge de 14 points).
    expect(html).toContain("bg-transparent px-4 py-3.5 max-lg:-mt-[62px]");
    // Le fondu de la photo nette (96 points) commence au-dessus de la carte ; le voile blanc ne démarre qu'après 60 points.
    expect(html).toContain("rgba(255,255,255,0) 60px");
    // Écran d'aujourd'hui (sans copie floue) : aucun chevauchement.
    expect(login({ loginImageUrl: IMAGE })).not.toContain("-mt-[62px]");
    // Ordinateur : rien ne change (le chevauchement est réservé au téléphone).
    expect(html).not.toMatch(/(?<!max-)lg:-mt-/);
  });

  it("plus aucune légende « Photo : … Pexels » (ordinateur et téléphone, avec ou sans fond flou)", () => {
    for (const html of [login(), login({ loginImageUrl: IMAGE }), login({ loginImageUrl: IMAGE, loginImageBlurUrl: BLUR })]) {
      expect(html).not.toContain("Katerina Holmes");
      expect(html).not.toContain("Pexels");
    }
    expect(readFileSync("src/components/auth/LoginScreen.tsx", "utf8")).not.toContain("LOGIN_PHOTO_CREDIT");
  });

  it("ordinateur : AUCUN élément en miroir ; la copie floue n'est étirée qu'à partir du bord de la photo", () => {
    const html = login();
    expect(html).not.toMatch(/-scale-x-|scaleX\(-|rotate/);
    const desktop = html.slice(html.indexOf('data-testid="login-blur-desktop"'), html.indexOf("<aside"));
    expect(desktop).toContain("origin-[calc(100%-24px)_50%] scale-x-[30]");
    // Une seule photo nette sur la page : rien n'est répété.
    expect(html.match(/src="\/connexion-enseignante\.jpg"/g)?.length).toBe(1);
  });

  it("logo posé à plat sur le blanc : aucune ombre, fond presque blanc ramené au blanc", () => {
    const html = login();
    const logo = html.slice(html.indexOf('alt="Logo de l&#x27;application"'));
    const logoClass = logo.slice(logo.indexOf('class="'), logo.indexOf('"', logo.indexOf('class="') + 7));
    expect(logoClass).not.toContain("drop-shadow");
    expect(logoClass).toContain("brightness-[1.02]");
  });

  it("image choisie avec sa copie floue : la copie floue enregistrée est utilisée", () => {
    const html = login({ loginImageUrl: IMAGE, loginImageBlurUrl: BLUR });
    expect(html).toContain(`src="${BLUR}"`);
    expect(html).not.toContain(LOGIN_PHOTO_BLUR_SRC);
    expect(html).toContain('data-testid="login-blur-desktop"');
  });

  it("valeur de repli : image choisie SANS copie floue (anciennes images) → écran d'aujourd'hui, sans fond flou", () => {
    const html = login({ loginImageUrl: IMAGE });
    expect(html).not.toContain("login-blur-");
    expect(html).not.toContain(LOGIN_PHOTO_BLUR_SRC);
    expect(html).toContain("[border-radius:0_0_50%_50%/0_0_22px_22px]");
    expect(html).not.toContain("max-lg:overflow-visible");
    expect(loginBackgroundBlurSrc(IMAGE, "")).toBe("");
    expect(loginBackgroundBlurSrc("", "")).toBe(LOGIN_PHOTO_BLUR_SRC);
    expect(loginBackgroundBlurSrc(IMAGE, BLUR)).toBe(BLUR);
  });

  it("téléphone : AUCUNE photo retournée ; dessous, la même photo entière en flou léger, à l'endroit", () => {
    const html = login();
    const source = readFileSync("src/components/auth/LoginScreen.tsx", "utf8");
    const aside = source.slice(source.indexOf("<aside"), source.indexOf("</aside>"));
    expect(aside).not.toMatch(/scale-y|scaleY|rotate/);
    const below = html.slice(html.indexOf('data-testid="login-blur-phone"'));
    const belowBox = below.slice(0, below.indexOf("</div></div>"));
    expect(belowBox).toContain("top-[calc(100%-56px)] h-[calc(100dvh-100%+56px)]");
    expect(belowBox).toContain(`src="${LOGIN_PHOTO_BLUR_SRC}"`);
    expect(belowBox).toContain("object-cover object-[50%_50%]");
    expect(belowBox).not.toMatch(/scale|rotate/);
    // Aucun reflet, ni sur téléphone ni sur ordinateur.
    expect(html.match(/-scale-x-100/g)).toBeNull();
    expect(html.match(/scale-y/g)).toBeNull();
  });

  it("copie floue qui ne se charge pas : retour automatique à l'écran d'aujourd'hui", () => {
    const source = readFileSync("src/components/auth/LoginScreen.tsx", "utf8");
    expect(source).toContain("const blurred = Boolean(blurSrc) && !blurFailed;");
    expect(source.match(/onError=\{onBlurError\}/g)?.length).toBe(3);
  });

  it("copie floue de l'image d'origine : petit fichier fixe (préparé une fois, pas de flou calculé à l'ouverture)", () => {
    expect(existsSync("public/connexion-enseignante-flou.jpg")).toBe(true);
    expect(statSync("public/connexion-enseignante-flou.jpg").size).toBeLessThan(40 * 1024);
    const source = readFileSync("src/components/auth/LoginScreen.tsx", "utf8");
    expect(source).not.toMatch(/filter:\s*blur|blur-\[|backdrop-blur/);
  });

  it("les animations de la photo restent celles d'aujourd'hui (le reflet net zoome avec la photo)", () => {
    const source = readFileSync("src/components/auth/LoginScreen.tsx", "utf8");
    expect(source).toContain(".login-photo-zoom { animation: loginPhotoZoom 4s ease-in-out infinite alternate; will-change: transform; }");
    expect(source).toContain(".login-advantage { opacity: 0; animation: loginAdvantageCycle 6s ease-in-out infinite; }");
    expect(login().match(/class="login-photo-zoom /g)?.length).toBe(1);
  });
});
