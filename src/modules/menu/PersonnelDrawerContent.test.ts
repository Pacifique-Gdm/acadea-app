import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/menu/PersonnelDrawerContent.tsx", "utf8");

describe("Drawer Personnels", () => {
  it("conserve liste, filtres, actions et impression", () => {
    expect(source).toContain('useState<"active" | "archived">("active")');
    expect(source).toContain('aria-haspopup="listbox"');
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain("printPersonnelListPdf(school, visible, view)");
    expect(source).toContain("printPersonnelProfilePdf(school, selected, profile)");
  });

  it("présente exactement les sept rubriques du formulaire de modification dans l'ordre", () => {
    const titles = ["1. IDENTIFICATION", "2. COORDONNÉES", "3. SITUATION PROFESSIONNELLE", "4. FORMATION ET QUALIFICATIONS", "5. INFORMATIONS COMPLÉMENTAIRES", "6. OBSERVATIONS", "7. INFORMATIONS SYSTÈME — LECTURE SEULE"];
    let previous = -1;
    titles.forEach((title) => { const index = source.indexOf(`title="${title}"`); expect(index).toBeGreaterThan(previous); previous = index; });
  });

  it("préremplit l'identité, la photo et les sections sans inventer une seconde source", () => {
    expect(source).toContain("const identity = personnelIdentity(item, profile)");
    expect(source).toContain("setProfileForm({ ...profile, ...identity");
    expect(source).toContain("setSections(userSectionIds(item))");
    expect(source).toContain("profile?.photoUrl && <img");
  });

  it("attend le profil temps réel avant d'autoriser modification et impression", () => {
    expect(source).toContain("const [profileReady, setProfileReady] = useState(false)");
    expect(source).toContain("setProfile(nextProfile); setProfileReady(true)");
    expect(source).toContain('disabled={readOnly || busy || !profileReady || selected.role === "school_admin"}');
    expect(source).toContain("disabled={busy || !profileReady}");
  });

  it("rend matricule et date d'établissement en lecture seule depuis users.createdAt", () => {
    expect(source).toContain('label="Matricule (automatique — lecture seule)"');
    expect(source).toContain('label="Date d’établissement de la fiche" value={dateShown(selected.createdAt)} readOnly');
  });

  it("préserve multi-sélection, e-mail sécurisé, observations multilignes et persistance", () => {
    expect(source).toContain('<MultiSelectDropdown label="Sections"');
    expect(source).toContain("await updatePersonnel(");
    expect(source).toContain('label="E-mail" value={email}');
    expect(source).toContain("<textarea");
    expect(source).toContain("subscribeToPersonnelProfile");
    expect(source).toContain("subscribeToSchoolPersonnel");
  });

  it("affiche un fallback de section compréhensible, y compris lorsque l’école n’en a aucune", () => {
    expect(source).toContain("const schoolSections = getSchoolSections(school)");
    expect(source).toContain('placeholder={schoolSections.length ? "Non renseignée" : "Aucune section disponible"}');
    expect(source).not.toContain("compatibilité historique");
  });

  it("limite le sexe aux valeurs acceptées par l’API", () => {
    expect(source).toContain('<option value="F">Féminin</option>');
    expect(source).toContain('<option value="M">Masculin</option>');
    expect(source).toContain('<option value="Autre">Autre</option>');
  });

  it("nettoie les messages lors des fermetures et conserve leur accessibilité", () => {
    expect(source).toContain("useAutoDismissMessage(error");
    expect(source).toContain("useAutoDismissMessage(success");
    expect(source).toContain("function closeSelected()");
    expect(source).toContain('role="alert" aria-live="assertive"');
    expect(source).toContain('role="status" aria-live="polite"');
  });

  it("exige les phrases exactes pour archiver et désarchiver", () => {
    expect(source).toContain('"ARCHIVER PERSONNEL"');
    expect(source).toContain('"DÉSARCHIVER PERSONNEL"');
    expect(source).toContain('if (statusConfirmation !== expectedConfirmation) return');
    expect(source).toContain('disabled={busy || statusConfirmation !== expectedConfirmation}');
    expect(source).toContain('setStatusConfirmation("")');
    expect(source).not.toContain('statusConfirmation.trim()');
    expect(source).not.toContain('statusConfirmation.toUpperCase()');
  });
});
