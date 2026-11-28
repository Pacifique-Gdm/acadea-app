// « Répartir le Reste » (décisions de l'utilisateur du 28/11/2026) : écran du détail d'une ligne « ↳ ».
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubRubricDetail } from "./SubRubricDetail";
import type { AllocationRow, AllocationSubLine } from "../../utils/feeAllocationView";

const row = { key: "s/y/3/r", schoolId: "s", schoolName: "École", yearName: "2026-2027", currency: "USD", rubricName: "Fonctionnement", rubricId: "a".repeat(32), amountMinor: 14400 } as AllocationRow;
const line = (id: string, name: string): AllocationSubLine => ({ id, name, plannedMinor: 8080, receivedMinor: 6535, openingMinor: 1403, cumulativeReceivedMinor: 6535, cumulativeSpentMinor: 0, availableMinor: 7938 });
const render = (sub: AllocationSubLine, extra: Partial<Parameters<typeof SubRubricDetail>[0]> = {}) => renderToStaticMarkup(createElement(SubRubricDetail,
  { row, sub, filterLabel: "Frais : Tous les frais", schoolId: "s", canRedistribute: true, restAvailableMinor: 7938, onClose: () => {}, onDone: () => {}, ...extra }));

describe("détail d'une ligne « ↳ » et bouton « Répartir le Reste »", () => {
  it("détail présenté comme celui d'une rubrique, avec toutes ses colonnes", () => {
    const html = render(line("craies", "Craies et papier (30 %)"));
    expect(html).toContain("↳ Craies et papier (30 %)");
    expect(html).toContain("Sous-rubrique de « Fonctionnement »");
    for (const label of ["Prévu de l&#x27;année", "Encaissé selon le filtre", "Ouverture", "Encaissé (cumul)", "Dépensé (cumul)", "Disponible"]) expect(html).toContain(label);
    // Pas de bouton dans le détail d'une sous-rubrique ordinaire.
    expect(html).not.toContain("data-redistribute-rest");
  });
  it("le bouton n'apparaît que dans le détail de « ↳ Reste », seul et pleine largeur, pour l'Administrateur, s'il y a de l'argent", () => {
    const html = render(line("UNALLOCATED", "Reste"));
    expect(html).toMatch(/<button[^>]*class="primary-button min-h-11 w-full justify-center"[^>]*data-redistribute-rest[^>]*>Répartir le Reste<\/button>/);
    expect(render(line("UNALLOCATED", "Reste"), { canRedistribute: false })).not.toContain("data-redistribute-rest");
    expect(render(line("UNALLOCATED", "Reste"), { restAvailableMinor: 0 })).not.toContain("data-redistribute-rest");
  });
  it("après la répartition : le bouton disparaît et le message « Reste réparti le … par … » s'affiche", () => {
    const html = render(line("UNALLOCATED", "Reste"), { redistributedAt: "2026-11-28T09:15:00.000Z" });
    expect(html).not.toContain("data-redistribute-rest");
    expect(html).toMatch(/Reste réparti le 28\/11\/2026 à \d{2}:\d{2} par l&#x27;administrateur\./);
  });
  it("confirmation : phrase exacte, « Répartir » désactivé tant qu'elle n'est pas exacte, deux boutons à 50 %", () => {
    const source = readFileSync(new URL("./SubRubricDetail.tsx", import.meta.url), "utf8");
    expect(source).toContain('export const SUB_REST_PHRASE = "RÉPARTIR CE RESTE";');
    expect(source).toContain('disabled={busy || !exact} onClick={() => void confirm()}>Répartir</button>');
    expect(source).toContain("const exact = typed === SUB_REST_PHRASE;");
    expect(source).toMatch(/<div className=\{BUTTON_ROW\}>\s*<button type="button" className="secondary-button min-h-11 w-full[^\n]*>Annuler<\/button>\s*<button type="button" className="primary-button min-h-11 w-full[^\n]*>Répartir<\/button>\s*<\/div>/);
  });
  it("tableaux : le nom d'une ligne « ↳ » est cliquable (sauf vue partagée du personnel) et ouvre son détail", () => {
    const drawer = readFileSync(new URL("./FeeAllocationDrawer.tsx", import.meta.url), "utf8");
    expect(drawer).toContain("onClick: () => setSubDetail({ row, sub })");
    expect(drawer).toContain("{...(staffView ? {} : { role: \"button\", tabIndex: 0");
    expect(drawer).toContain("<SubRubricDetail ");
  });
});
