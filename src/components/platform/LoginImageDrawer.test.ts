import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginScreen } from "../auth/LoginScreen";
import { LoginImageDesktopPreview, LoginImageDrawer, LoginImagePhonePreview } from "./LoginImageDrawer";

const IMAGE = "data:image/webp;base64,AAAA";
const login = (loginImageUrl?: string) => renderToStaticMarkup(createElement(LoginScreen, {
  onLogin: async () => undefined,
  platformLogoUrl: "",
  ...(loginImageUrl === undefined ? {} : { loginImageUrl }),
}));

describe("image de l'écran de connexion (lot 9) : écran et drawer", () => {
  it("sans image choisie, l'écran de connexion reste exactement le même", () => {
    const html = login();
    expect(login("")).toBe(html);
    expect(html).toContain('src="/connexion-enseignante.jpg"');
    expect(html).toContain("Enseignante souriante qui interroge ses élèves");
    expect(html).toContain("Photo : Katerina Holmes · Pexels");
  });

  it("avec une image choisie, seule la photo change : même mise en page", () => {
    const html = login(IMAGE);
    expect(html).toContain(`src="${IMAGE}"`);
    expect(html).not.toContain("/connexion-enseignante.jpg");
    // Le crédit de la photo d'origine n'a plus lieu d'être.
    expect(html).not.toContain("Katerina Holmes");
    const layout = (markup: string) => markup
      .replace(/<link rel="preload" as="image" href="[^"]*"\/>/g, "")
      .replace(/<img src="[^"]*" alt="[^"]*"/, "<img")
      .replace(/<p class="absolute right-3 top-2[^"]*">[^<]*<\/p>/, "");
    expect(layout(html)).toBe(layout(login()));
  });

  it("le drawer montre l'aperçu ordinateur ET téléphone, sans bouton Actualiser", () => {
    const html = renderToStaticMarkup(createElement(LoginImageDrawer, { platformLogoUrl: "" }));
    expect(html).toContain('data-testid="login-preview-desktop"');
    expect(html).toContain('data-testid="login-preview-phone"');
    expect(html).toContain("Ordinateur");
    expect(html).toContain("Téléphone");
    expect(html).toContain("Choisir une image");
    expect(html).toContain("Enregistrer l&#x27;image");
    expect(html).toContain("Revenir à l&#x27;image d&#x27;origine");
    expect(html).toContain("sous 100 Ko");
    expect(html).not.toContain("Actualiser");
  });

  it("les deux aperçus utilisent la même image", () => {
    for (const preview of [LoginImageDesktopPreview, LoginImagePhonePreview]) {
      const html = renderToStaticMarkup(createElement(preview, { imageUrl: IMAGE, logoUrl: "" }));
      expect(html).toContain(`src="${IMAGE}"`);
    }
  });

  it("Menu : drawer réservé au Super administrateur et relu par la flèche ronde de l'en-tête", () => {
    const platform = readFileSync("src/modules/platform/PlatformModule.tsx", "utf8");
    expect(platform).toContain('{platformMenuDrawer === "login-image" && user.role === "super_admin" && (');
    expect(platform).toContain('<LoginImageDrawer platformLogoUrl={platformLogoUrl} refreshToken={headerRefreshToken} />');
    expect(platform).toContain("onClickCapture={() => setHeaderRefreshToken((value) => value + 1)} onClick={() => onRefresh?.()}");
  });
});
