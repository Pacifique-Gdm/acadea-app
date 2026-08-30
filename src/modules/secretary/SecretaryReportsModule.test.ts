import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("formulaire Nouveau rapport", () => {
  const source = readFileSync(new URL("./SecretaryReportsModule.tsx", import.meta.url), "utf8");
  const sectionSource = readFileSync(new URL("./reportAiSections.ts", import.meta.url), "utf8");
  const signatoriesEditorSource = readFileSync(new URL("./SignatoriesEditor.tsx", import.meta.url), "utf8");
  const actionsSource = readFileSync(new URL("./SecretaryDocumentFormActions.tsx", import.meta.url), "utf8");
  const signatorySource = readFileSync(new URL("./reportSignatories.ts", import.meta.url), "utf8");
  const pdfSource = readFileSync(new URL("../../utils/pdf.ts", import.meta.url), "utf8");

  it("laisse le Select actif pour une nouvelle création et expose tous les types", () => {
    expect(source).toContain('const readOnly = !canManage || Boolean(selected && selected.status !== "draft")');
    expect(source).toContain('aria-label="Type de rapport"');
    for (const type of ["meeting_minutes", "activity_report", "incident_report", "official_minutes", "administrative_note", "other"]) expect(source).toContain(type);
    expect(source).toContain("setType(event.target.value as SecretaryReportType)");
  });

  it("enregistre et réinitialise Heure de début et Heure de fin", () => {
    expect(source).toContain("Heure de début");
    expect(source).toContain("Heure de fin");
    expect(source).toContain('onInput={(event) => setStartTime(event.currentTarget.value)}');
    expect(source).toContain('onInput={(event) => setEndTime(event.currentTarget.value)}');
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
    expect(source).toContain('generateLabel={selected ? "Enregistrer" : "Générer rapport"}');
    expect(actionsSource).toContain("disabled={busy || disabled}");
    const createIndex = source.indexOf("await createSecretaryReport");
    expect(createIndex).toBeGreaterThan(-1);
    expect(source.indexOf("setOpen(false)", createIndex)).toBeGreaterThan(createIndex);
    expect(source).toContain("Rapport généré et enregistré en brouillon.");
    expect(source).toContain("console.error(\"Échec de la génération du rapport\"");
  });

  it("maintient tous les contrôles Rapports sur une ligne desktop sans forcer le mobile", () => {
    expect(source).toContain("sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)");
    expect(source).not.toContain("xl:grid-cols-[auto_minmax(220px,1fr)");
    expect(source).toContain('primary-button justify-center whitespace-nowrap px-3');
    expect(source).toContain('pdf-export-button whitespace-nowrap px-3');
    expect(source.match(/className="input min-w-0"/g)).toHaveLength(3);
  });

  it("soumet la modification d'un rapport existant sans créer de doublon", () => {
    expect(source).toContain("if (selected) await updateSecretaryReport");
    expect(source).toContain("else await createSecretaryReport");
    expect(source).toContain('generateLabel={selected ? "Enregistrer" : "Générer rapport"}');
    expect(source).not.toContain("onGenerate={selected ?");
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

  it("affiche des lignes structurées Noms et Fonction pour les signataires", () => {
    for (const label of ["LIEU", "OBJET", "PARTICIPANTS", "POINTS ABORDÉS", "DÉCISIONS", "RECOMMANDATIONS"]) expect(`${source}\n${sectionSource}`).toContain(label);
    expect(signatoriesEditorSource).toContain('title = "SIGNATAIRES"');
    expect(signatoriesEditorSource).toContain('placeholder="Noms"');
    expect(signatoriesEditorSource).toContain('placeholder="Fonction"');
    expect(signatoriesEditorSource).toContain("Ajouter un signataire");
    expect(source).not.toContain('>SIGNATURES</h3>');
    expect(source).toContain("prepareReportSignatories(signatories)");
    expect(source).not.toContain('key={field}>{field}<textarea');
  });

  it("compacte Lieu et Objet et utilise la casse normale uniquement dans le formulaire", () => {
    for (const label of ["Lieu", "Objet", "Participants", "Points abordés", "Décisions", "Recommandations"]) expect(source).toContain(`"${label}"`);
    expect(source).toContain('field === "lieu" || field === "objet"');
    expect(source).toContain('"min-h-12" : "min-h-20"');
    expect(source).toContain('title="Signataires"');
    expect(source).toContain("report-form-section grid gap-1 pt-2");
    expect(source).not.toContain('"font-bold uppercase"');
    expect(source).toContain("MEETING_MINUTES_SECTION_LABELS[key");
  });

  it("isole les espacements du PDF individuel des rapports", () => {
    expect(source).toContain('{ className: "report-section" }');
    expect(pdfSource).toContain(".pdf-section.report-section");
    expect(pdfSource).toContain("margin-top: 16px");
    expect(pdfSource).toContain("margin-bottom: 4px");
    expect(pdfSource).toContain(".pdf-header *");
    expect(source).toContain("reportSignatoriesPdfHtml(reportSignatories)");
  });

  it("produit un PDF administratif justifié avec quatre cartes et trois signataires maximum par ligne", () => {
    expect(source).toContain('class="report-info-row"');
    expect(source).toContain('class="report-justified-text"');
    expect(signatorySource).toContain('class="report-signatories"');
    expect(source).not.toContain('pdfSection("SIGNATURES"');
    expect(source).toContain("reportSignatoriesPdfHtml(reportSignatories)");
    expect(signatorySource).toContain('class="report-signatures-block"');
    expect(signatorySource).toContain('class="report-signatory-name"');
    expect(signatorySource).toContain('class="report-signatory-function"');
    expect(source).toContain("normalizeReportSignatories(report.signatories, report.structuredContent.signatures)");
    expect(source).toContain("MEETING_MINUTES_SECTION_ORDER.filter");
    expect(signatorySource).toContain('report-signatory-row--${row.length}');
    expect(pdfSource).toContain(".report-signatory-row--1 .report-signatory");
    expect(pdfSource).toContain("grid-column: 2");
    expect(pdfSource).toContain(".report-signatory-row--2 .report-signatory:first-child");
    expect(pdfSource).toContain(".report-signatory-row--2 .report-signatory:last-child");
    expect(pdfSource).toContain("grid-column: 3");
    expect(pdfSource).not.toContain("border-top: 1px solid #14213d;\n      text-align: center;\n      page-break-inside");
  });

  it("retire uniquement STATUT des métadonnées et redistribue les quatre cartes", () => {
    const metadataStart = source.indexOf('class="report-info-row"');
    const metadataEnd = source.indexOf("...contentEntries.map", metadataStart);
    const metadata = source.slice(metadataStart, metadataEnd);
    for (const label of ["DATE", "HEURE DE DÉBUT", "HEURE DE FIN", "AUTEUR"]) expect(metadata).toContain(`label: "${label}"`);
    expect(metadata).not.toContain('label: "STATUT"');
    expect(pdfSource).toContain('pdfSettings.pageSize === "A5" ? 2 : 4');
    expect(pdfSource).toContain(".pdf-header *");
  });

  it("affiche et applique les mêmes réglages au rapport enregistré et prévisualisé", () => {
    for (const label of ["PdfSettingsFields", "pdfSettings", "readStoredPdfSettings", "normalizePdfSettings"]) expect(source).toContain(label);
    expect(source).toContain("pdfSettings: report.pdfSettings");
    expect(source).toContain("signatories, pdfSettings");
    expect(pdfSource).toContain("getPdfLayout(pdfSettings)");
    expect(pdfSource).toContain("format: layout.jsPdfFormat");
    expect(pdfSource).toContain("line-height: ${pdfSettings.lineSpacing}");
    expect(pdfSource).toContain('const institutionalFontFamily = resolvePdfFont("Aptos")');
    expect(pdfSource).toContain(".pdf-header *");
    expect(pdfSource).toContain("font-family: ${institutionalFontFamily}");
    expect(source).toContain("pdfEditorStyle(pdfSettings)");
    expect(source).toContain("style={editorStyle}");
  });
});
