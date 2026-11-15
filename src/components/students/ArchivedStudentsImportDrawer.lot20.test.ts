import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnnualDecisions, AnnualSummary, summarize } from "./ArchivedStudentsImportDrawer";
import type { ArchivedStudentsImportStatus } from "../../services/provisioning";

const student = (id: string, className: string) => ({ id, matricule: id.toUpperCase(), name: `Élève ${id}`, className });
const status: ArchivedStudentsImportStatus = {
  status: "ready", sourceCount: 6, importedCount: 0, existingCount: 0, remaining: 6, complete: false, sourceYearId: "old", schoolYearId: "new",
  promotedCount: 1, decisionRequired: true, withoutOption: [], decisionsLocked: false,
  finalists: [student("f1", "4ème Humanité"), student("f2", "4ème Humanité")],
  groups: [
    { key: "Maternelle 2::", kind: "missing-class", sourceClassName: "Maternelle 2", targetClassName: "Maternelle 3", section: "Maternelle", decisionRequired: true, canOpen: true, students: [student("m1", "Maternelle 2")] },
    { key: "6ème Primaire::", kind: "missing-cycle", sourceClassName: "6ème Primaire", targetClassName: "7ème CTEB", section: "CTEB", defaultDecision: "leave", decisionRequired: false, canOpen: true, students: [student("p1", "6ème Primaire")] },
    { key: "8ème CTEB::", kind: "missing-class", sourceClassName: "8ème CTEB", targetClassName: "1ère Humanité", section: "Secondaire", decisionRequired: true, canOpen: true, students: [student("c1", "8ème CTEB")] },
  ],
};

describe("lot 20 : écran de la Secrétaire", () => {
  it("bloque tant qu'une décision manque et le dit clairement", () => {
    const review = summarize(status, {}, new Set());
    expect(review.missing.map((group) => group.key)).toEqual(["Maternelle 2::", "8ème CTEB::"]);
    expect(renderToStaticMarkup(createElement(AnnualSummary, { review }))).toContain("Décision requise pour : Maternelle 2 → Maternelle 3, 8ème CTEB → 1ère Humanité");
  });

  it("résume montées, archivés avec motifs, classes ouvertes et entrées en 1ère Humanité sans option", () => {
    const review = summarize(status, { "Maternelle 2::": "open", "8ème CTEB::": "open" }, new Set(["f2"]));
    expect(review).toMatchObject({ promoted: 3, missing: [], openedClasses: ["Maternelle 3", "1ère Humanité"] });
    const html = renderToStaticMarkup(createElement(AnnualSummary, { review }));
    expect(html).toContain("Élève f1 (4ème Humanité) : Finaliste : fin du cycle secondaire");
    expect(html).toContain("Élève p1 (6ème Primaire) : Fin de parcours dans l&#x27;école : cycle CTEB non organisé");
    expect(html).not.toContain("Élève f2 (");
    expect(html).toContain("Élèves entrant en 1ère Humanité sans option (1)");
  });

  it("propose les deux choix par groupe et le retrait d'un partant", () => {
    const html = renderToStaticMarkup(createElement(AnnualDecisions, { status, decisions: {}, retained: new Set<string>(), locked: false, onDecide: () => {}, onToggleRetained: () => {} }));
    expect(html.match(/Ouvrir la classe suivante/g)).toHaveLength(3);
    expect(html.match(/Les élèves quittent l&#x27;école/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Finalistes de 4ème Humanité (2)");
    expect(html.match(/Garder \(retirer des partants\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
