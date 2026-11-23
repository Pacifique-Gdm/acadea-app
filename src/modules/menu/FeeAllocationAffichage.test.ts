import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SocialLinesEditor } from "./FeeAllocationSocialPart";

// Version 1.19.1 : affichage des formulaires « Partie 2 — cas sociaux » et « Ajouter une répartition ».
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const social = read("FeeAllocationSocialPart.tsx"), drawer = read("FeeAllocationDrawer.tsx");
const lines = [{ id: "a".repeat(32), name: "Part de l'école", mode: "percent" as const, value: "40" }, { id: "b".repeat(32), name: "Part des enseignants", mode: "percent" as const, value: "30" }];
const render = (secondAction?: string) => renderToStaticMarkup(createElement(SocialLinesEditor, { lines, currency: "USD", onChange: () => undefined, onCopyPartOne: () => undefined,
  ...(secondAction ? { secondAction: createElement("button", { type: "button" }, secondAction) } : {}) }));
const element = (html: string, marker: string) => html.slice(html.lastIndexOf("<div", html.indexOf(marker)));

describe("formulaires de répartition : mise en page (1.19.1)", () => {
  it("« Recopier la partie 1 » et « Appliquer à tous les frais » sur la même ligne, moitié-moitié", () => {
    const html = render("Appliquer à tous les frais");
    const row = element(html, "data-copy-actions");
    expect(row).toMatch(/^<div class="[^"]*grid-cols-2[^"]*" data-copy-actions/);
    expect(row.indexOf("Recopier la partie 1")).toBeLessThan(row.indexOf("Appliquer à tous les frais"));
    expect(social).toContain("secondAction={items.length > 1 && <button");
  });
  it("sans second bouton (« Ajouter une répartition ») : « Recopier » prend toute la largeur", () => {
    const row = element(render(), "data-copy-actions");
    expect(row).toMatch(/^<div class="[^"]*grid-cols-1[^"]*" data-copy-actions/);
    expect(row).toMatch(/class="secondary-button w-full[^"]*">Recopier la partie 1</);
  });
  it("« Retirer la ligne » sur la même ligne que le champ « Pourcentage (%) », dans les deux formulaires", () => {
    const html = render();
    // Le champ et le bouton sont frères, dans la même rangée horizontale.
    expect(html).toMatch(/<div class="flex [^"]*"><input [^>]*aria-label="Valeur Part de l&#x27;école"[^>]*\/><button [^>]*>Retirer la ligne<\/button><\/div>/);
    expect(drawer).toMatch(/<div className="flex min-w-0 items-stretch gap-2"><input id=\{`valeur-ligne-\$\{index\}`\}[^\n]*>Retirer la ligne<\/button><\/div>/);
    expect(`${social}${drawer}`).not.toContain('className="secondary-button self-end"');
  });
  it("« Annuler » à gauche de « Publier la partie 2 », moitié-moitié ; il ferme sans rien publier", () => {
    const block = social.slice(social.indexOf("data-social-publish-actions"));
    expect(social).toContain('<div className="grid w-full grid-cols-2 gap-2" data-social-publish-actions>');
    expect(block.indexOf(">Annuler</button>")).toBeLessThan(block.indexOf('"Publier la partie 2"'));
    expect(block).toMatch(/disabled=\{busy\} onClick=\{onClose\}>Annuler<\/button>/);
  });
  it("« Ajouter une répartition » : plus de « école · année · devise », la phrase préparatoire reste", () => {
    expect(drawer).not.toContain("{workspace.school.name} · {workspace.year.name} · {workspace.currency}");
    expect(drawer).toContain('<p className="mb-3 text-sm">Enregistrement préparatoire uniquement.</p>');
  });
});
