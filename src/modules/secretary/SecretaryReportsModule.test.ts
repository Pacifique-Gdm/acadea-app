import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("formulaire Nouveau rapport", () => {
  const source = readFileSync(new URL("./SecretaryReportsModule.tsx", import.meta.url), "utf8");
  const sectionSource = readFileSync(new URL("./reportAiSections.ts", import.meta.url), "utf8");
  const pdfSource = readFileSync(new URL("../../utils/pdf.ts", import.meta.url), "utf8");

  it("laisse le Select actif pour une nouvelle création et expose tous les types", () => {
    expect(source).toContain('const readOnly = Boolean(selected && selected.status !== "draft")');
    expect(source).toContain('aria-label="Type de rapport"');
    for (const type of ["meeting_minutes", "activity_report", "incident_report", "official_minutes", "administrative_note", "other"]) expect(source).toContain(type);
    expect(source).toContain("setType(event.target.value as SecretaryReportType)");
  });

  it("enregistre et réinitialise Heure de début et Heure de fin", () => {
    expect(source).toContain("Heure de début");
    expect(source).toContain("Heure de fin");
    expect(source).toContain('type="time"');
    expect(source).toContain("startTime, endTime");
    expect(source).toContain('setStartTime("")');
    expect(source).toContain('setEndTime("")');
  });

  it("refuse une heure de fin antérieure et affiche l'erreur dans le formulaire", () => {
    expect(source).toContain("if (endTime < startTime)");
    expect(source).toContain("L'heure de fin doit être postérieure ou égale à l'heure de début.");
    expect(source).toContain("{formError &&");
  });

  it("génère, désactive pendant le traitement et ferme uniquement après succès", () => {
    expect(source).toContain('busy ? "Enregistrement en cours…" : "Générer rapport"');
    expect(source).toContain("disabled={busy}");
    const createIndex = source.indexOf("await createSecretaryReport");
    expect(createIndex).toBeGreaterThan(-1);
    expect(source.indexOf("setOpen(false)", createIndex)).toBeGreaterThan(createIndex);
    expect(source).toContain("Rapport généré et enregistré en brouillon.");
    expect(source).toContain("console.error(\"Échec de la génération du rapport\"");
  });

  it("transmet le type métier sélectionné à l'Assistant IA", () => {
    expect(source).toContain('documentCategory="rapport"');
    expect(source).toContain("documentTypeLabel={labels[type]}");
    expect(source).toContain("documentDate={date}");
    expect(source).toContain("documentTime={startTime}");
    expect(source).toContain("documentEndTime={endTime}");
    expect(source).toContain("buildReportAiSections(type, content)");
    expect(source).toContain("sections={aiSections}");
    expect(source).toContain("sectionLabels={aiSectionLabels}");
    expect(source).toContain("const updatedFormValues = applyReportAiSections(type, previous, generated)");
    expect(source).toContain("return updatedFormValues");
    expect(source).not.toContain("sections={{ Titre: title, ...content }}");
    expect(source).toContain("await createSecretaryReport");
  });

  it("affiche les titres du compte rendu en majuscules et remplace le textarea Signatures", () => {
    for (const label of ["LIEU", "OBJET", "PARTICIPANTS", "POINTS ABORDÉS", "DÉCISIONS", "RECOMMANDATIONS", "SIGNATURES"]) expect(`${source}\n${sectionSource}`).toContain(label);
    expect(source).toContain('className="text-sm font-bold uppercase">SIGNATURES');
    expect(source).toContain('aria-label="Nom du signataire"');
    expect(source).toContain("Ajouter un signataire");
    expect(source).toContain("addReportSignatory(signatories, signatoryName)");
    expect(source).not.toContain('key={field}>{field}<textarea');
  });

  it("produit un PDF administratif justifié avec cinq cartes et trois signataires maximum par ligne", () => {
    expect(source).toContain('class="report-info-row"');
    expect(source).toContain('class="report-justified-text"');
    expect(source).toContain('class="report-signatories"');
    expect(source).toContain('pdfSection("SIGNATURES"');
    expect(source).toContain("normalizeReportSignatories(report.signatories, report.structuredContent.signatures)");
    expect(source).toContain("MEETING_MINUTES_SECTION_ORDER.filter");
    expect(source).toContain('report-signatory-row--${row.length}');
    expect(pdfSource).toContain(".report-signatory-row--1 .report-signatory");
    expect(pdfSource).toContain("grid-column: 2");
    expect(pdfSource).toContain(".report-signatory-row--2 .report-signatory:first-child");
    expect(pdfSource).toContain(".report-signatory-row--2 .report-signatory:last-child");
    expect(pdfSource).toContain("grid-column: 3");
  });

  it("affiche et applique les mêmes réglages au rapport enregistré et prévisualisé", () => {
    for (const label of ["PdfSettingsFields", "pdfSettings", "readStoredPdfSettings", "normalizePdfSettings"]) expect(source).toContain(label);
    expect(source).toContain("pdfSettings: report.pdfSettings");
    expect(source).toContain("signatories, pdfSettings");
    expect(pdfSource).toContain("getPdfLayout(pdfSettings)");
    expect(pdfSource).toContain("format: layout.jsPdfFormat");
    expect(pdfSource).toContain("line-height: ${pdfSettings.lineSpacing}");
  });
});
