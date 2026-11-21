import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchoolLogo } from "../components/platform/SchoolLogo";
import { LOGO_THUMB_ATTEMPTS, LOGO_THUMB_MAX_CHARS, LOGO_THUMB_TARGET_CHARS, isValidLogoThumbnail, pickLogoThumbnail } from "./logoThumbnail";
import { primeSchoolLogo, resetSchoolLogoCacheForTests } from "./schoolLogo";
import { loadCoordinationLogo, resetCoordinationLogoCacheForTests } from "./coordinationLogo";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { LOGO_THUMB_ATTEMPTS as SERVER_ATTEMPTS, LOGO_THUMB_MAX_CHARS as SERVER_MAX, LOGO_THUMB_TARGET_CHARS as SERVER_TARGET, isValidLogoThumbnail as serverValid } from "../../api/_lib/logoThumbnail.js";
import type { School } from "../types";

const source = (path: string) => readFileSync(path, "utf8");
const LOGO = "data:image/png;base64,QUFBQQ==";
const THUMB = `data:image/webp;base64,${"B".repeat(3000)}`;
const school: School = { id: "school-a", name: "École Saint Joseph", address: "", phone: "", email: "", activeSchoolYearId: "y", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 };
const image = (chars: number) => `data:image/webp;base64,${"A".repeat(chars - "data:image/webp;base64,".length)}`;

afterEach(() => { resetSchoolLogoCacheForTests(); resetCoordinationLogoCacheForTests(); });

describe("vignette du logo", () => {
  it("garde la même limite côté navigateur, serveur et règles Firestore", () => {
    expect(LOGO_THUMB_MAX_CHARS).toBe(8000);
    expect(SERVER_MAX).toBe(LOGO_THUMB_MAX_CHARS);
    expect(SERVER_TARGET).toBe(LOGO_THUMB_TARGET_CHARS);
    expect(SERVER_ATTEMPTS).toEqual(LOGO_THUMB_ATTEMPTS);
    expect(source("firestore.rules")).toContain("data.logoThumbUrl.size() <= 8000");
    for (const value of [image(8000), image(8001), "https://exemple.test/a.png", "", 3]) expect(serverValid(value)).toBe(isValidLogoThumbnail(value));
  });

  it("choisit le premier essai d'environ 4 Ko, du plus net au plus léger", async () => {
    const sizes: number[] = [];
    const encode = (size: number) => { sizes.push(size); return image(size >= 96 ? 12000 : 5000); };
    const picked = await pickLogoThumbnail(encode);
    expect(picked.length).toBeLessThanOrEqual(LOGO_THUMB_TARGET_CHARS);
    expect(sizes).toEqual([96, 96, 80]);
  });

  it("ne rend jamais une vignette plus lourde que la limite", async () => {
    expect(await pickLogoThumbnail(() => image(9000))).toBe("");
    expect(await pickLogoThumbnail(() => "")).toBe("");
    // Aucun essai sous 4 Ko mais sous la limite : la plus légère est gardée.
    let call = 0;
    const lightest = await pickLogoThumbnail(() => image([7900, 7000, 7500, 7200, 7800][call++]));
    expect(lightest.length).toBe(7000);
    expect(call).toBe(LOGO_THUMB_ATTEMPTS.length);
  });
});

describe("listes du Super administrateur : vignette seulement", () => {
  it("la liste des écoles affiche la vignette sans lire le logo complet", () => {
    const loader = vi.fn(async () => ({ logoUrl: LOGO }));
    resetSchoolLogoCacheForTests({ loader, storage: null });
    const html = renderToStaticMarkup(createElement(SchoolLogo, { school: { ...school, logoVersion: "v1", logoThumbUrl: THUMB } }));
    expect(html).toContain(`src="${THUMB}"`);
    expect(loader).not.toHaveBeenCalled();
  });

  it("le drawer de l'école affiche le logo complet, jamais la vignette", () => {
    resetSchoolLogoCacheForTests({ loader: async () => null, storage: null });
    primeSchoolLogo("school-a", "v1", LOGO);
    const html = renderToStaticMarkup(createElement(SchoolLogo, { school: { ...school, logoVersion: "v1", logoThumbUrl: THUMB }, full: true }));
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).not.toContain(THUMB);
    expect(source("src/modules/platform/PlatformModule.tsx")).toContain("<SchoolLogo school={drawerSchool} full />");
  });

  it("une école pas encore migrée garde son logo complet dans la liste", () => {
    resetSchoolLogoCacheForTests({ loader: async () => null, storage: null });
    primeSchoolLogo("school-a", "v1", LOGO);
    const html = renderToStaticMarkup(createElement(SchoolLogo, { school: { ...school, logoVersion: "v1" } }));
    expect(html).toContain(`src="${LOGO}"`);
  });

  it("la liste des coordinations n'affiche que la vignette ; le détail lit le logo complet à part", () => {
    const management = source("src/modules/platform/CoordinationManagement.tsx");
    expect(management).toContain("<CoordinationListLogo coordination={item} />");
    expect(management).toContain("useCoordinationLogoThumbnail(coordination)");
    expect(management).toContain("useCoordinationLogo(selected)");
    expect(management).not.toMatch(/selected\.logoUrl/);
    expect(source("src/modules/coordination/CoordinationPortal.tsx")).not.toMatch(/coordination\??\.logoUrl/);
  });
});

describe("logo de la coordination rangé à part", () => {
  it("se lit dans coordinationLogos, une seule fois par version", async () => {
    const loader = vi.fn(async () => ({ logoUrl: LOGO, logoVersion: "c1" }));
    resetCoordinationLogoCacheForTests({ loader, storage: null });
    expect(await loadCoordinationLogo({ id: "coord-a", logoVersion: "c1" })).toBe(LOGO);
    expect(await loadCoordinationLogo({ id: "coord-a", logoVersion: "c1" })).toBe(LOGO);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith("coord-a");
  });

  it("garde l'ancien champ logoUrl tant qu'il existe, sans lecture", async () => {
    const loader = vi.fn(async () => null);
    resetCoordinationLogoCacheForTests({ loader, storage: null });
    expect(await loadCoordinationLogo({ id: "coord-a", logoUrl: LOGO })).toBe(LOGO);
    expect(loader).not.toHaveBeenCalled();
  });

  it("les paramètres de la coordination ne renvoient le logo que s'il a changé", () => {
    const menu = source("src/modules/coordination/CoordinationMenu.tsx");
    expect(menu).not.toContain("logoUrl: coordination.logoUrl");
    expect(menu).toContain("...(logoChanged ? { logoUrl: logoDraft } : {})");
    expect(source("src/services/coordinationService.ts")).toContain("createLogoThumbnail(settings.logoUrl)");
  });

  it("les PDF de la coordination lisent son logo complet à part", () => {
    expect(source("src/utils/pdf.ts")).toContain("loadLogoDataUrl(await loadInstitutionLogo(school))");
    expect(source("src/modules/coordination/coordinationPdfInstitution.ts")).toContain("logoVersion: coordination.logoVersion");
  });
});
