import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("module Courrier du Secrétaire", () => {
  const moduleSource = readFileSync(new URL("./SecretaryCorrespondenceModule.tsx", import.meta.url), "utf8");
  const formSource = readFileSync(new URL("./OutgoingCorrespondenceForm.tsx", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../../services/secretaryCorrespondence.ts", import.meta.url), "utf8");

  it("affiche les huit colonnes attendues avec des cellules tronquées", () => {
    for (const title of ["Référence", "Date", "Type", "Expéditeur", "Destinataire", "Objet", "Statut", "Actions"]) expect(moduleSource).toContain(`>${title}<`);
    expect(moduleSource).toContain("truncate p-3");
    expect(moduleSource).toContain('title={value || "-"}');
    expect(moduleSource).not.toContain("Dernière modification");
    expect(moduleSource).not.toContain("Consulter</button>");
  });

  it("confirme strictement l'archivage avec une saisie manuelle", () => {
    expect(moduleSource).toContain("ARCHIVER LE COURRIER");
    expect(moduleSource).toContain("Cette opération va déplacer ce courrier dans les archives.");
    expect(moduleSource).toContain('confirmationText !== expected');
    expect(moduleSource).toContain("Le texte de confirmation est incorrect.");
    expect(moduleSource).toContain('setSensitiveAction({ kind: "archive", target: item })');
    expect(moduleSource).toContain("await archiveCorrespondence(user, sensitiveAction.target)");
  });

  it("désarchive dans Firestore en restaurant le statut antérieur", () => {
    expect(moduleSource).toContain("Désarchiver");
    expect(moduleSource).toContain('setSensitiveAction({ kind: "unarchive", target: item })');
    expect(moduleSource).toContain("await unarchiveCorrespondence(user, sensitiveAction.target)");
    expect(serviceSource).toContain("archivedFromStatus: current.status");
    expect(serviceSource).toContain("status: restoredStatus");
  });

  it("supprime définitivement Firestore et nettoie Storage après confirmation", () => {
    expect(moduleSource).toContain('label="Supprimer définitivement"');
    expect(moduleSource).toContain('setSensitiveAction({ kind: "delete", target: item })');
    expect(moduleSource).toContain("SUPPRIMER LE COURRIER");
    expect(moduleSource).toContain("await deleteCorrespondencePermanently");
    expect(serviceSource).toContain('await deleteDoc(doc(db, "correspondences", current.id))');
    expect(serviceSource).toContain("await listAll(folder)");
    expect(serviceSource).toContain("deleteObject(item)");
  });

  it("rend le dialogue accessible et bloque les doubles clics", () => {
    expect(moduleSource).toContain('role="dialog"');
    expect(moduleSource).toContain('aria-modal="true"');
    expect(moduleSource).toContain("autoFocus");
    expect(moduleSource).toContain("if (value === expected && !busy)");
    expect(moduleSource).toContain("disabled={busy || value !== expected}");
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
});
