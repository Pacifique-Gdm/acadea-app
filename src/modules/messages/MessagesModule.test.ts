import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MessagesModule.tsx", import.meta.url), "utf8");
const selectorSource = readFileSync(new URL("./AdministrativeRecipientSelector.tsx", import.meta.url), "utf8");
const directoryHook = readFileSync(new URL("../../hooks/useSchoolMessageRecipients.ts", import.meta.url), "utf8");

describe("messagerie des modules administratifs", () => {
  it("conserve un seul formulaire principal et supprime le formulaire Secretaire separe", () => {
    expect(source).toContain('<FormPanel title="Envoyer un message">');
    expect(source).not.toMatch(/FormPanel title="[ÉE]crire au Secr/);
    expect(source.match(/<FormPanel title=/g)).toHaveLength(1);
  });

  it("integre Administratifs au selecteur existant et conserve la selection multiple", () => {
    expect(source).toContain('<option value="administrative">Administratifs</option>');
    expect(source).toContain("AdministrativeRecipientSelector");
    expect(selectorSource).toContain("searchResults.map");
    expect(selectorSource).toContain('type="checkbox"');
    expect(source).toContain("selectedAdministrativeIds");
    expect(source).toContain("sendSchoolMessage");
  });

  it("affiche le second filtre et rend les destinataires réels même sans recherche", () => {
    expect(selectorSource).toContain('Tous les {label}s');
    expect(selectorSource).toContain('Sélection {label}');
    expect(selectorSource).toContain('mode === "all"');
    expect(selectorSource).toContain("searchResults.map");
    expect(source).toContain("showRecipientsWithoutSearch={isSchoolAdmin}");
    expect(selectorSource).toContain("showRecipientsWithoutSearch && !search.trim()");
    expect(selectorSource).toContain("Recherchez un administratif par nom ou fonction.");
    expect(selectorSource).toContain("{recipient.name} — {administrativeRoleLabel(recipient.role)}");
    expect(selectorSource).toContain('aria-label={`Retirer ${recipient.name}`}');
  });

  it("preserve les categories Parents et les flux existants", () => {
    expect(source).toContain('<option value="parents">Parents d\'élèves</option>');
    expect(source).toContain("persistMessageWithConversation");
    expect(source).toContain("selectedDisciplineParentIds");
    expect(source).toContain("selectedAdminParentIds");
  });

  it("étend au Caissier les Parents de l'année active avec résolution UID et lots de 50", () => {
    expect(source).toContain('isSchoolAdmin || isSecretary || isCashier ? (');
    expect(source).toContain('currentYearParentCandidates');
    expect(source).toContain('secureParentRecipientIds');
    expect(source).toContain('[parent.userId, parent.id].find');
    expect(source).toContain('Math.ceil(resolvedSecureRecipientIds.length / 50)');
    expect(source).toContain('resolvedSecureRecipientIds.slice(index * 50, (index + 1) * 50)');
    expect(source).toContain(':parents:${index + 1}:${recipientBatches.length}');
    expect(source).toContain('<option value="all">Tous les parents</option>');
    expect(source).toContain('<option value="parents">Sélection parent</option>');
    expect(source).toContain('removeAdminParent(parent.id)');
  });

  it("ajoute la catégorie Enseignants avec les deux modes de sélection", () => {
    expect(source).toContain('<option value="teachers">Enseignants</option>');
    expect(source).toContain('kind="teacher"');
    expect(selectorSource).toContain("Tous les {label}s");
    expect(selectorSource).toContain("Sélection {label}");
  });

  it("laisse l'objet manuel pour un Directeur de discipline écrivant aux administratifs", () => {
    expect(source).toContain('user.role === "discipline_director" && recipientCategory === "parents"');
    expect(source).toContain('<input value={subject} onChange={(event) => setSubject(event.target.value)} className="input" placeholder="Objet" />');
    expect(source).toContain('setRecipientCategory(event.target.value as "parents" | "administrative" | "teachers"); setSubject("")');
    expect(source).toContain('disabled={!subject || !body');
  });

  it("ajoute Coordinateur et Sous-coordinateur via l'annuaire sécurisé temps réel", () => {
    expect(source).toContain("useSchoolMessageRecipients(user, school)");
    expect(directoryHook).toContain('collection(db, "subCoordinationSchools")');
    expect(directoryHook).toContain('doc(db, "coordinations", coordinationId)');
    expect(directoryHook).toContain('doc(db, "users", id)');
    expect(directoryHook).toContain("loadSchoolMessageRecipients");
    expect(directoryHook).not.toContain("setTimeout");
  });
});
