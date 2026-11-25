import { useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { Field, MultiSelectDropdown, PasswordField } from "../../components/ui";
import { useAutoDismissMessage, ERROR_MESSAGE_DURATION_MS, SUCCESS_MESSAGE_DURATION_MS } from "../../hooks/useAutoDismissMessage";
import { provisionSchoolUser } from "../../services/provisioning";
import { subscribeToSchoolTeacherAccounts } from "../../services/teacherAccounts";
import type { AppData, AppUser, School, SchoolSection, SchoolYear } from "../../types";
import { isValidProvisioningPhone, nextSchoolStaffEmail, normalizeProvisioningPhone } from "../../utils/schoolAccountCredentials";
import { schoolSectionLabels } from "../../utils/schoolConfig";
import { sectionsAvailableToUser } from "../../utils/userSections";
import { temporaryPasswordAfterPhoneChange } from "../../utils/temporaryPassword";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { useLoadRetry } from "../../hooks/useLoadRetry";

export function StudyTeacherCreateContent({ user, school, year, appData, updateData }: {
  user: AppUser;
  school: School;
  year: SchoolYear;
  appData: AppData;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
}) {
  const [teacherAccounts, setTeacherAccounts] = useState<AppUser[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sectionIds, setSectionIds] = useState<SchoolSection[]>([]);
  const [emailEdited, setEmailEdited] = useState(false);
  const [passwordEdited, setPasswordEdited] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorLoad, setErrorLoad] = useState("");
  const errorLoadRetry = useLoadRetry(Boolean(errorLoad), () => setErrorLoad(""));
  const [success, setSuccess] = useState("");
  // Lot 2 : le directeur ne choisit que parmi SES sections (le serveur le vérifie aussi).
  const schoolSections = sectionsAvailableToUser(user, school);
  const generatedEmail = useMemo(
    () => nextSchoolStaffEmail(school, "teacher", [...appData.users, ...teacherAccounts], appData.parents),
    [appData.parents, appData.users, school, teacherAccounts],
  );

  useAutoDismissMessage(error, () => setError(""), ERROR_MESSAGE_DURATION_MS);
  useAutoDismissMessage(success, () => setSuccess(""), SUCCESS_MESSAGE_DURATION_MS);
  useEffect(() => subscribeToSchoolTeacherAccounts({
    user,
    schoolId: school.id,
    onData: (items) => { setTeacherAccounts(items); setAccountsLoaded(true); },
    onError: () => { setAccountsLoaded(true); setErrorLoad("Impossible d’actualiser les comptes enseignants."); },
  }), [school.id, user, errorLoadRetry.token]);
  useEffect(() => {
    if (!emailEdited) setEmail(generatedEmail);
  }, [emailEdited, generatedEmail]);

  async function submit() {
    const normalizedPhone = normalizeProvisioningPhone(phone);
    setError("");
    setSuccess("");
    if (!name.trim() || !email.trim() || !normalizedPhone) {
      setError("Nom, téléphone et email sont requis.");
      return;
    }
    if (!isValidProvisioningPhone(normalizedPhone)) {
      setError("Le numéro de téléphone n’est pas valide.");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe temporaire doit contenir au moins 6 caractères.");
      return;
    }
    if ([...appData.users, ...teacherAccounts].some((item) => item.email.trim().toLowerCase() === email.trim().toLowerCase())) {
      setError("Un compte existe déjà avec cet email.");
      return;
    }
    setBusy(true);
    try {
      const created = await provisionSchoolUser({
        role: "teacher",
        schoolId: school.id,
        schoolYearId: year.id,
        name: name.trim(),
        email: email.trim(),
        password,
        phone: normalizedPhone,
        section: sectionIds[0],
        sectionIds,
      });
      updateData({ users: [...appData.users.filter((item) => item.id !== created.id), created] }, { persist: false });
      setTeacherAccounts((current) => [...current.filter((item) => item.id !== created.id), created]);
      setName("");
      setPhone("");
      setPassword("");
      setSectionIds([]);
      setEmailEdited(false);
      setPasswordEdited(false);
      setPasswordVisible(false);
      setSuccess("Compte enseignant créé avec succès.");
    } catch (caught) {
      setError(userFacingError(caught, "Création du compte enseignant impossible."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid min-w-0 gap-4">
    <ErrorNotice error={errorLoad} onRetry={errorLoadRetry.retry} /><ErrorNotice error={error} />
    {success && <p role="status" aria-live="polite" className="rounded border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-800">{success}</p>}
    <Field label="Type d’utilisateur" value="Enseignant" onChange={() => undefined} disabled />
    <MultiSelectDropdown label="Sections" options={schoolSections.map((section) => ({ value: section, label: schoolSectionLabels[section] }))} values={sectionIds} onChange={(values) => setSectionIds(values as SchoolSection[])} placeholder={schoolSections.length ? "Non renseignée" : "Aucune section disponible"} />
    <Field label="Nom complet" value={name} onChange={setName} />
    <Field label="Téléphone" value={phone} onChange={(value) => {
      setPhone(value);
      setPassword(temporaryPasswordAfterPhoneChange({ nextPhone: value, currentPassword: password, manuallyEdited: passwordEdited }));
    }} />
    <Field label="Email" value={email} onChange={(value) => { setEmail(value); setEmailEdited(true); }} />
    <PasswordField label="Mot de passe temporaire" value={password} onChange={(value) => { setPassword(value); setPasswordEdited(true); }} visible={passwordVisible} onToggle={() => setPasswordVisible((current) => !current)} />
    <button type="button" className="primary-button justify-center disabled:opacity-50" disabled={busy || !accountsLoaded || !name.trim() || !email.trim() || !phone.trim() || !password} onClick={() => void submit()}>
      <UserRound className="h-4 w-4" /> {busy ? "Création…" : "Créer l’enseignant"}
    </button>
  </div>;
}
