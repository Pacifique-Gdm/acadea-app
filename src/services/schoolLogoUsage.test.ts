import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SchoolLogo } from "../components/platform/SchoolLogo";
import { primeSchoolLogo, resetSchoolLogoCacheForTests } from "./schoolLogo";
import type { School } from "../types";

const source = (path: string) => readFileSync(path, "utf8");
const LOGO = "data:image/png;base64,QUFBQQ==";
const school: School = { id: "school-a", name: "École Saint Joseph", address: "", phone: "", email: "", activeSchoolYearId: "y", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 };

afterEach(() => resetSchoolLogoCacheForTests());

describe("affichage du logo rangé à part", () => {
  it("l'en-tête, les cartes et les PDF passent tous par le logo rangé à part", () => {
    expect(source("src/components/layout/Header.tsx")).toContain("useSchoolLogo(school)");
    expect(source("src/components/platform/SchoolLogo.tsx")).toContain("useSchoolLogo(school)");
    expect(source("src/utils/pdf.ts")).toContain("loadLogoDataUrl(await loadSchoolLogo(school))");
    for (const file of ["src/components/layout/Header.tsx", "src/components/platform/SchoolLogo.tsx", "src/utils/pdf.ts"]) {
      expect(source(file)).not.toMatch(/school\.logoUrl/);
    }
  });

  it("les paramètres école n'écrivent plus l'image dans le document de l'école", () => {
    const repository = source("src/services/schoolOptionsRepository.ts");
    expect(repository).toContain("logoUrl: deleteField()");
    expect(repository).not.toMatch(/logoUrl: desiredSchool\.logoUrl/);
  });

  it("affiche le même logo qu'avant, qu'il soit dans l'ancien champ ou rangé à part", () => {
    resetSchoolLogoCacheForTests({ loader: async () => null, storage: null });
    const legacy = renderToStaticMarkup(createElement(SchoolLogo, { school: { ...school, logoUrl: LOGO } }));
    primeSchoolLogo("school-a", "v1", LOGO);
    const stored = renderToStaticMarkup(createElement(SchoolLogo, { school: { ...school, logoVersion: "v1" } }));
    expect(stored).toBe(legacy);
    expect(stored).toContain(`src="${LOGO}"`);
  });

  it("garde le sigle quand l'école n'a pas de logo", () => {
    resetSchoolLogoCacheForTests({ loader: async () => null, storage: null });
    const html = renderToStaticMarkup(createElement(SchoolLogo, { school: { ...school, acronym: "ESJ", logoVersion: "" } }));
    expect(html).toContain("ESJ");
    expect(html).not.toContain("<img");
  });
});
