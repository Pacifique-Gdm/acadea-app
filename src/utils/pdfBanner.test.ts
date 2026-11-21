import { describe, expect, it } from "vitest";
import { buildTwoCopyPdfHtml } from "./pdf";
import { DEFAULT_PDF_SETTINGS, PDF_LINE_SPACINGS, type PdfLineSpacing } from "./pdfSettings";
import type { School } from "../types";

/**
 * Bandeau commun des PDF : le PDF est dessiné dans la page de l'application,
 * où la base Tailwind (preflight) s'applique aussi :
 *   h1, h2 { font-weight: inherit }   html { line-height: 1.5 }
 * Ces tests calculent le style final (règle la plus précise, puis la dernière)
 * comme le navigateur, à partir de la vraie feuille de style des PDF.
 */
const TAILWIND_BASE = "h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; } small { font-size: 80%; }";
const PAGE_LINE_HEIGHT = 1.5;
/** html2canvas place la ligne de base 2 px plus bas que le navigateur (FontMetrics : « + 2 »). */
const HTML2CANVAS_BASELINE_OFFSET_PX = 2;
/** Bas des lettres « g », « p », « j » sous la ligne de base (Aptos et polices de secours). */
const DESCENT_EM = 0.3;

function pdfCss(lineSpacing: PdfLineSpacing = DEFAULT_PDF_SETTINGS.lineSpacing) {
  const html = buildTwoCopyPdfHtml({
    title: "Reçu de paiement",
    school: { id: "ecole-a", name: "École fictive Acadéa" } as School,
    generatedAt: new Date("2026-11-20T23:59:58"),
    logoDataUrl: "",
    showDocumentTitle: true,
    centerDocumentTitle: false,
    sections: ["<p>x</p>"],
    pdfSettings: { ...DEFAULT_PDF_SETTINGS, lineSpacing },
    renderWidth: 794,
    renderHeight: 1100,
    copyLabels: ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE PARENT"],
  });
  return html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
}

type Rule = { selectors: string[]; declarations: Map<string, string>; order: number };

function parseRules(css: string): Rule[] {
  return Array.from(css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match, order) => ({
    selectors: match[1].split(",").map((selector) => selector.trim().replace(/\s+/g, " ")),
    declarations: new Map(match[2].split(";").map((part) => part.split(":")).filter((pair) => pair.length >= 2)
      .map(([name, ...value]) => [name.trim(), value.join(":").replace(/!important/, "").trim()])),
    order,
  }));
}

function specificity(selector: string) {
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const tags = selector.split(" ").filter((part) => /^[a-z][a-z0-9]*$/.test(part)).length;
  return classes * 100 + tags;
}

/**
 * Valeur finale d'une propriété pour un élément décrit par ses ancêtres, du plus
 * haut au plus bas (ex. [".pdf-copy", ".document-title", "small"]).
 * Un sélecteur s'applique si sa dernière partie vise l'élément et que les autres
 * parties se retrouvent, dans l'ordre, parmi les ancêtres.
 */
function computed(css: string, path: string[], property: string) {
  const target = path[path.length - 1];
  const ancestors = path.slice(0, -1);
  const matches = (selector: string) => {
    const parts = selector.split(" ");
    if (parts[parts.length - 1] !== target) return false;
    let cursor = 0;
    for (const part of parts.slice(0, -1)) {
      while (cursor < ancestors.length && ancestors[cursor] !== part) cursor += 1;
      if (cursor === ancestors.length) return false;
      cursor += 1;
    }
    return true;
  };
  let best: { value: string; specificity: number; order: number } | undefined;
  for (const rule of parseRules(`${TAILWIND_BASE}\n${css}`)) {
    const value = rule.declarations.get(property);
    if (value === undefined) continue;
    for (const selector of rule.selectors.filter(matches)) {
      const weight = specificity(selector);
      if (!best || weight > best.specificity || (weight === best.specificity && rule.order >= best.order)) best = { value, specificity: weight, order: rule.order };
    }
  }
  return best?.value;
}

const px = (value: string | undefined) => {
  const match = value?.match(/^([\d.]+)px$/);
  if (!match) throw new Error(`Valeur en px attendue, reçu : ${value}`);
  return Number(match[1]);
};
const paddingBottom = (value: string | undefined) => {
  const parts = (value ?? "").split(/\s+/);
  return px(parts.length === 1 ? parts[0] : parts.length === 2 ? parts[0] : parts[2]);
};

describe("bandeau commun des PDF", () => {
  it("écrit le nom de l'école et le titre du document en gras, malgré la base Tailwind", () => {
    const css = pdfCss();
    // « inherit » reprend le poids du texte courant du PDF : normal (400).
    const weight = (path: string[]) => {
      const value = computed(css, path, "font-weight");
      return value === undefined || value === "inherit" || value === "normal" ? 400 : Number(value);
    };
    for (const copy of [[], [".pdf-copy"]]) {
      expect(weight([...copy, ".school-block", "h1"]), `${copy.join(" ")} nom de l'école`).toBeGreaterThanOrEqual(700);
      expect(weight([...copy, ".document-title", "h2"]), `${copy.join(" ")} titre du document`).toBeGreaterThanOrEqual(700);
    }
  });

  it.each(PDF_LINE_SPACINGS.map((spacing) => [spacing]))("garde la date de génération dans son cadre une fois dessinée par html2canvas (interligne %s)", (spacing) => {
    const css = pdfCss(spacing);
    for (const copy of [[], [".pdf-copy"]]) {
      for (const line of ["small", "span"]) {
        const fontSize = px(computed(css, [...copy, ".document-title", line], "font-size"));
        const lineHeight = Number(computed(css, [...copy, ".document-title", line], "line-height") ?? spacing);
        // html2canvas mesure la ligne de base avec l'interligne de la page (1,5) :
        // un interligne plus petit fait descendre les lettres sous leur ligne.
        expect(lineHeight, `${copy.join(" ")} .document-title ${line}`).toBeGreaterThanOrEqual(PAGE_LINE_HEIGHT);
        const frameBottom = paddingBottom(computed(css, [...copy, ".document-title"], "padding"));
        const needed = HTML2CANVAS_BASELINE_OFFSET_PX + DESCENT_EM * fontSize + 1;
        expect(frameBottom, `marge du bas du cadre ${copy.join(" ")} (${line} en ${fontSize}px)`).toBeGreaterThanOrEqual(needed);
      }
    }
  });
});
