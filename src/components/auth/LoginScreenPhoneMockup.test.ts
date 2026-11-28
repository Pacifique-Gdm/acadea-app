import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = () => readFileSync("src/components/auth/LoginScreen.tsx", "utf8");

describe("écran de connexion : maquette téléphone validée le 25/11/2026", () => {
  it("photo en bandeau d'environ la moitié, bas arrondi, sans défilement de la page", () => {
    const source = screen();
    expect(source).toContain('<main className="flex h-dvh w-full flex-col overflow-hidden bg-white');
    expect(source).toContain("min-h-[120px] flex-[0_1_50%] overflow-hidden [border-radius:0_0_50%_50%/0_0_22px_22px]");
  });

  it("n'affiche plus le crédit de la photo (retiré aussi sur ordinateur le 28/11/2026 : Pexels n'exige pas de citation)", () => {
    expect(screen()).not.toContain("{LOGIN_PHOTO_CREDIT}");
  });

  it("le grand titre n'est plus visible sur téléphone (le slogan est dans le logo)", () => {
    expect(screen()).toContain('<h1 className="sr-only lg:hidden">{LOGIN_SLOGAN}</h1>');
  });

  it("une seule mention de sécurité sur téléphone : « Connexion / Accédez… » masqué, « Espace sécurisé » gardé", () => {
    const source = screen();
    expect(source).toContain('<div className="hidden text-center lg:mt-7 lg:block">');
    expect(source).toContain("Espace sécurisé");
  });

  it("formulaire à plat sur téléphone : carte, bordure et ombres seulement sur ordinateur", () => {
    const source = screen();
    expect(source).toContain("lg:block lg:flex-none lg:overflow-hidden lg:rounded-[24px] lg:border lg:border-white/80 lg:p-6 lg:shadow-[0_24px_80px_rgba(15,23,42,0.10)]");
    expect(source).toContain("lg:mt-1 lg:h-14 lg:shadow-[0_16px_34px_rgba(20,33,61,0.22)]");
  });

  it("les 4 avantages sont animés sur la photo, en boucle, et immobiles si l'appareil demande moins d'animations", () => {
    const source = screen();
    expect(source).toContain("LOGIN_ADVANTAGES_PHONE.map((advantage, index)");
    expect(source).toContain('className="login-advantage flex gap-[7px] whitespace-nowrap"');
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).not.toContain('<ul className="mt-4 grid w-full max-w-[460px] gap-1.5 text-xs text-slate-500 lg:hidden">');
  });

  it("ordinateur : seules les animations de la photo sont ajoutées (zoom et avantages)", () => {
    const source = screen();
    expect(source).toContain('className="login-advantage flex items-start gap-3" style={advantageDelay(index)}');
    expect(source).toContain("login-photo-zoom absolute inset-0 h-full w-full");
    expect(source).toContain("lg:origin-[50%_40%] lg:object-[50%_30%]");
  });
});
