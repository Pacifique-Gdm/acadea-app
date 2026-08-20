import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("module Courrier du Secrétaire", () => {
const moduleSource = readFileSync(new URL("./SecretaryCorrespondenceModule.tsx", import.meta.url), "utf8");
const deleteDialogSource = readFileSync(new URL("./SecretaryDocumentDeleteDialog.tsx", import.meta.url), "utf8");
  const formSource = readFileSync(new URL("./OutgoingCorrespondenceForm.tsx", import.meta.url), "utf8");
  const actionsSource = readFileSync(new URL("./SecretaryDocumentFormActions.tsx", import.meta.url), "utf8");
  const signatoriesSource = readFileSync(new URL("./SignatoriesEditor.tsx", import.meta.url), "utf8");
  const viewActionSource = readFileSync(new URL("./SecretaryViewActionButton.tsx", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../../services/secretaryCorrespondence.ts", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../../components/pdf/PdfSettingsFields.tsx", import.meta.url), "utf8");
  const optionsSource = readFileSync(new URL("./correspondenceOptions.ts", import.meta.url), "utf8");

  it("centralise Kinshasa / RDC uniquement comme valeur initiale des nouveaux courriers", () => {
    expect(formSource).toContain('DEFAULT_OUTGOING_ISSUE_PLACE = "Kinshasa / RDC"');
    expect(formSource).toContain("current?.outgoing ?? initialOutgoing(user, school, year)");
  });

  it("masque Auteur et Statut tout en conservant leurs valeurs système", () => {
    expect(formSource).not.toContain('<ReadOnly label="Auteur"');
    expect(formSource).not.toContain('<ReadOnly label="Statut"');
    expect(formSource).toContain("authorName: user.name");
    expect(formSource).toContain('status: current?.status ?? "draft"');
    expect(formSource).toContain("createdBy: current?.createdBy ?? user.id");
  });

  it("ajoute les PDF individuel et filtré sans conserver Tous les canaux", () => {
    expect(moduleSource).toContain('label="Afficher le PDF"');
    expect(moduleSource).toContain("showCorrespondencePdf(item)");
    expect(moduleSource).toContain("exportCorrespondenceListPdf({ rows: filtered");
    expect(moduleSource).toContain("Exporter PDF");
    expect(moduleSource).not.toContain("Tous les canaux");
  });

  it("retire les mentions historiques du formulaire sans les supprimer du modèle", () => {
    for (const label of ["Niveau de confidentialité", "Sous couvert de", "Mention spéciale", "Préciser la mention"]) expect(formSource).not.toContain(label);
    for (const field of ["confidentiality", "underCoverOf", "specialMention", "customSpecialMention"]) expect(readFileSync(new URL("./secretaryTypes.ts", import.meta.url), "utf8")).toContain(field);
    expect(formSource).toContain('confidentiality: "public"');
  });

  it("partage la source des modes et exporte exactement la liste filtrée", () => {
    expect(formSource).toContain("options={CORRESPONDENCE_DELIVERY_MODES}");
    expect(moduleSource).toContain("CORRESPONDENCE_DELIVERY_MODES.map");
    expect(optionsSource).toContain('"hand_delivery"');
    expect(moduleSource).toContain('aria-label="Mode d’acheminement"');
    expect(moduleSource).toContain('<option value="all">Tous les modes</option>');
    expect(moduleSource).toContain("filterSecretaryCorrespondences(items, queryText, direction, outgoingType, priority, deliveryMode)");
    expect(moduleSource).toContain("exportCorrespondenceListPdf({ rows: filtered");
  });

  it("affiche les sept colonnes attendues avec des cellules tronquées", () => {
    for (const title of ["Référence", "Date", "Type", "Expéditeur", "Destinataire", "Objet", "Actions"]) expect(moduleSource).toContain(`>${title}<`);
    expect(moduleSource).not.toContain(">Statut<");
    expect(moduleSource).toContain("truncate p-3");
    expect(moduleSource).toContain('title={value || "-"}');
    expect(moduleSource).not.toContain("Dernière modification");
    expect(moduleSource).not.toContain("Consulter</button>");
  });

  it("confirme strictement la suppression définitive avec une saisie manuelle", () => {
    expect(moduleSource).toContain("SUPPRIMER COURRIER");
    expect(deleteDialogSource).toContain("Cette action supprimera définitivement ce");
    expect(deleteDialogSource).toContain("Le texte de confirmation est incorrect.");
    expect(moduleSource).toContain('setSensitiveAction({ kind: "delete", target: item })');
    expect(moduleSource).toContain("await deleteCorrespondencePermanently(user, sensitiveAction.target, confirmationText)");
    expect(moduleSource).not.toContain('changeArchiveState(item, "archive")');
    expect(moduleSource).toContain("restoreArchived(item)");
  });

  it("supprime définitivement Firestore et nettoie Storage après confirmation", () => {
    expect(moduleSource).toContain('label="Supprimer"');
    expect(moduleSource).toContain('setSensitiveAction({ kind: "delete", target: item })');
    expect(moduleSource).toContain("SUPPRIMER COURRIER");
    expect(moduleSource).toContain("await deleteCorrespondencePermanently");
    expect(serviceSource).toContain('"secretaryDeleteDocument"');
    expect(serviceSource).toContain('kind: "correspondence"');
    expect(serviceSource).not.toContain('deleteDoc(doc(db, "correspondences", current.id))');
  });

  it("rend le dialogue accessible et bloque les doubles clics", () => {
    expect(deleteDialogSource).toContain('role="dialog"');
    expect(deleteDialogSource).toContain('aria-modal="true"');
    expect(deleteDialogSource).toContain("autoFocus");
    expect(deleteDialogSource).toContain("if (value === expected && !busy)");
    expect(deleteDialogSource).toContain("disabled={busy || value !== expected}");
  });

  it("retire le filtre Courriers actifs sans retirer les autres filtres", () => {
    expect(moduleSource).not.toContain("Courriers actifs");
    expect(moduleSource).not.toContain("archiveView");
    for (const label of ["Tous les sens", "Tous les types", "Toutes les priorités", "Tous les modes"]) expect(moduleSource).toContain(label);
  });

  it("maintient tous les contrôles Courriers sur une ligne desktop sans forcer le mobile", () => {
    expect(moduleSource).toContain("sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)");
    expect(moduleSource).not.toContain("xl:grid-cols-7");
    expect(moduleSource).toContain('primary-button justify-center whitespace-nowrap px-3');
    expect(moduleSource).toContain('pdf-export-button whitespace-nowrap px-3');
    expect(moduleSource.match(/className="input min-w-0"/g)).toHaveLength(4);
  });

  it("retire le contenu obligatoire du courrier entrant", () => {
    expect(moduleSource).not.toContain('placeholder="Contenu"');
    expect(moduleSource).not.toContain("et le contenu du courrier");
    expect(moduleSource).toContain('input.direction === "incoming"');
    expect(moduleSource).toContain('aria-label="Pièce jointe"');
  });

  it("retire les fichiers numériques et la copie cachée du courrier sortant", () => {
    expect(formSource).not.toContain("Pièces jointes numériques");
    expect(formSource).not.toContain("Copie cachée interne");
    expect(formSource).not.toContain("DigitalFiles");
    expect(formSource).not.toContain("hiddenInternalCopies");
    expect(serviceSource).not.toContain("uploadOutgoingCorrespondenceFiles");
  });

  it("simplifie les actions du nouveau courrier sortant", () => {
    expect(actionsSource).toContain(">Annuler</button>");
    expect(actionsSource).toContain("grid-cols-2");
    expect(actionsSource).toContain("h-11 w-full");
    expect(formSource).toContain('generateLabel={current ? "Enregistrer" : "Générer courrier"}');
    for (const removedAction of ["Enregistrer comme brouillon", "Prévisualiser", "Soumettre à validation", "Générer le PDF", "Finaliser"]) expect(formSource).not.toContain(removedAction);
    expect(formSource).toContain('void act("draft")');
    expect(moduleSource).toContain("if (saveLock.current) return");
    expect(moduleSource).toContain("await createCorrespondence({ user, schoolId: school.id, schoolYearId: year.id");
    expect(moduleSource).toContain("finishSuccessfulSave");
  });

  it("enregistre un courrier existant sans créer de doublon", () => {
    expect(formSource).toContain("current ? act(current.status) : generate()");
    expect(moduleSource).toMatch(/editing\r?\n\s+\? \(await updateCorrespondence/);
    expect(moduleSource).toContain(": await createCorrespondence");
    expect(moduleSource).toContain("{ ...editing, ...payload }");
  });

  it("partage les signataires et l'action Voir iconique", () => {
    expect(formSource).toContain("normalizeCorrespondenceSignatories");
    expect(formSource).toContain("<SignatoriesEditor");
    expect(formSource).toContain('title="7. Signataires"');
    expect(formSource).toContain("showTitle={false}");
    expect(signatoriesSource).toContain("showTitle && <h3");
    expect(signatoriesSource).toContain('placeholder="Noms"');
    expect(signatoriesSource).toContain('placeholder="Fonction"');
    expect(signatoriesSource).toContain("Ajouter un signataire");
    expect(moduleSource).toContain("<SecretaryViewActionButton");
    expect(viewActionSource).toContain('title="Voir" aria-label="Voir"');
    expect(moduleSource).toContain('title="Courriers"');
  });

  it("transmet le type précis du courrier à l'Assistant IA", () => {
    expect(formSource).toContain('documentCategory="courrier"');
    expect(formSource).toContain("documentTypeLabel={correspondenceTypeLabel}");
    expect(formSource).toContain("documentDate={date}");
    expect(formSource).toContain("schoolName={school.name}");
    expect(formSource).toContain("correspondenceTypes.find");
  });

  it("retire Visa, Gestion interne et Mode d’envoi du formulaire puis renumérote les sections", () => {
    expect(formSource).not.toContain("Visa éventuel");
    expect(formSource).not.toContain("Visa requis");
    expect(formSource).not.toContain("Gestion interne");
    expect(formSource).not.toContain("Service émetteur");
    expect(formSource).not.toContain("Observations internes");
    expect(formSource).not.toContain('visa: { required: false }');
    expect(formSource).not.toContain('keywords: []');
    expect(formSource).not.toContain('title="9. Mode d’envoi"');
    expect(formSource).not.toContain('label="Canal d’envoi"');
    expect(formSource).not.toContain("L’adresse e-mail du destinataire est obligatoire");
    expect(formSource).not.toContain('sendingChannel: "physical"');
    for (const key of ["sendingChannel", "plannedSendDate", "recipientEmail", "receiptRequired", "sentBy", "actualSendDate", "confirmedReceptionDate"]) expect(formSource).toContain(`"${key}"`);
    const sectionTitles = [...formSource.matchAll(/<FormSection title="(\d+)\./g)].map((match) => Number(match[1]));
    expect(sectionTitles).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("conserve les anciennes données de visa consultables dans le PDF", () => {
    const pdfSource = readFileSync(new URL("./outgoingCorrespondencePdf.ts", import.meta.url), "utf8");
    expect(pdfSource).toContain("outgoing.visa?.required");
  });

  it("supprime structurellement le titre générique du PDF sortant uniquement", () => {
    const outgoingPdfSource = readFileSync(new URL("./outgoingCorrespondencePdf.ts", import.meta.url), "utf8");
    const sharedPdfSource = readFileSync(new URL("../../utils/pdf.ts", import.meta.url), "utf8");
    expect(outgoingPdfSource).toContain("showDocumentTitle: false");
    expect(outgoingPdfSource).not.toMatch(/Courrier administratif/i);
    expect(outgoingPdfSource).not.toContain('subtitle: item.referenceNumber');
    expect(outgoingPdfSource).toContain('style="margin:12px 18px 0"');
    expect(sharedPdfSource).toContain('showDocumentTitle ? `<div class="document-title');
    expect(sharedPdfSource).toContain('const institutionalFontFamily = resolvePdfFont("Aptos")');
    expect(sharedPdfSource).toContain(".pdf-header *");
    expect(sharedPdfSource).toContain("showDocumentTitle = true");
    expect(moduleSource).toContain('title: "Courrier administratif"');
  });

  it("nettoie le timer des messages", () => {
    expect(moduleSource).toContain("window.setTimeout");
    expect(moduleSource).toContain("window.clearTimeout");
  });

  it("affiche uniquement des icônes accessibles dans la colonne Actions", () => {
    expect(moduleSource).toContain("<CorrespondenceActionButton");
    expect(moduleSource).toContain("aria-label={label}");
    expect(moduleSource).toContain("title={label}");
    expect(moduleSource).toContain("h-9 w-9");
    expect(moduleSource).toContain("focus-visible:ring-2");
    expect(moduleSource).toContain("justify-center gap-1.5");
    expect(moduleSource).not.toContain("> PDF</button>");
    expect(moduleSource).not.toContain("> Archiver</button>");
    expect(moduleSource).not.toContain("> Désarchiver</button>");
  });

  it("synchronise le titre du Drawer avec le type sélectionné", () => {
    expect(moduleSource).toContain('useState<"" | CorrespondenceDirection>("")');
    expect(moduleSource).toContain('selectedDirection === "outgoing" ? "Nouveau courrier sortant"');
    expect(moduleSource).toContain('selectedDirection === "incoming" ? "Nouveau courrier entrant" : "Nouveau courrier"');
    expect(moduleSource).toContain("setSelectedDirection(nextDirection)");
    expect(moduleSource).toContain('setSelectedDirection("")');
    expect(moduleSource).toContain('<option value="" disabled>Sélectionner le type</option>');
  });

  it("affiche et persiste les réglages PDF du courrier sortant", () => {
    for (const label of ["Mise en forme du PDF", "Police", "Taille du texte", "Interligne", "Format de page"]) expect(settingsSource).toContain(label);
    expect(formSource).toContain("<PdfSettingsFields");
    expect(formSource).toContain("readStoredPdfSettings()");
    expect(formSource).toContain("pdfSettings,");
    expect(moduleSource).toContain("pdfSettings: payload.pdfSettings");
    expect(formSource).toContain("pdfEditorStyle(pdfSettings)");
    expect(formSource).toContain("style={editorStyle}");
  });

  it("utilise les identifiants techniques et la portée multiple pour l'Assistant IA Courrier", () => {
    for (const key of ["subject", "salutation", "introduction", "mainMessage", "details", "justification", "expectedFollowUp", "conclusion", "closingFormula"]) expect(formSource).toContain(key);
    expect(formSource).toContain("sectionLabels={aiSectionLabels}");
    expect(formSource).toContain("onApplySections={applyAiSections}");
    expect(formSource).not.toContain('const aiSections = { Objet:');
  });
});
