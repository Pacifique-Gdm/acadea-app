import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Link2, X } from "lucide-react";
import { Field, FormPanel, PasswordField } from "../ui";
import { provisionParent } from "../../services/provisioning";
import { temporaryPasswordAfterPhoneChange } from "../../utils/temporaryPassword";
import { emptyParent, nextParentEmail } from "../../utils/parents";
import type { AppData, AppUser, ParentProfile, School, SchoolYear, Student } from "../../types";

type ParentFormYearData = {
  parents: ParentProfile[];
  students: Student[];
};

export function ParentFormEditor({
  data,
  yearData,
  school,
  year,
  updateData,
  initialParentId,
  requestId,
  onBack,
  showBackButton = false,
  createId,
}: {
  data: AppData;
  yearData: ParentFormYearData;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  initialParentId?: string;
  requestId: number;
  onBack?: () => void;
  showBackButton?: boolean;
  createId: (prefix: string) => string;
}) {
  const [form, setForm] = useState<ParentProfile>(() => emptyParent(school.id, year.id));
  const [password, setPassword] = useState("");
  const [parentError, setParentError] = useState("");
  const [parentSuccess, setParentSuccess] = useState("");
  const [showParentPassword, setShowParentPassword] = useState(false);
  const [emailManuallyEdited, setEmailManuallyEdited] = useState(false);
  const [passwordManuallyEdited, setPasswordManuallyEdited] = useState(false);
  const [studentLinkSearch, setStudentLinkSearch] = useState("");
  const [studentSelectorOpen, setStudentSelectorOpen] = useState(false);
  const [studentSectionFilter, setStudentSectionFilter] = useState("");
  const [studentClassFilter, setStudentClassFilter] = useState("");
  const initializedRequestIdRef = useRef<number | null>(null);
  const generatedParentEmail = useMemo(() => nextParentEmail(school, data.users, data.parents), [data.parents, data.users, school]);
  const studentsById = useMemo(() => new Map(yearData.students.map((student) => [student.id, student])), [yearData.students]);
  const selectedLinkedStudents = useMemo(
    () => form.studentIds.map((studentId) => studentsById.get(studentId)).filter((student): student is Student => Boolean(student)),
    [form.studentIds, studentsById],
  );
  const sortedLinkStudents = useMemo(
    () =>
      yearData.students
        .filter((student) => student.schoolId === school.id && student.schoolYearId === year.id && (!student.status || student.status === "ACTIVE"))
        .sort((first, second) =>
        `${first.nom} ${first.postnom} ${first.prenom}`.replace(/\s+/g, " ").trim().localeCompare(`${second.nom} ${second.postnom} ${second.prenom}`.replace(/\s+/g, " ").trim(), "fr"),
      ),
    [school.id, year.id, yearData.students],
  );
  const studentSections = useMemo(
    () => Array.from(new Set(sortedLinkStudents.map((student) => student.section).filter((section): section is NonNullable<Student["section"]> => Boolean(section)))).sort(),
    [sortedLinkStudents],
  );
  const studentClasses = useMemo(
    () => Array.from(new Set(sortedLinkStudents.filter((student) => !studentSectionFilter || student.section === studentSectionFilter).map((student) => student.className))).sort(),
    [sortedLinkStudents, studentSectionFilter],
  );
  const normalizedStudentLinkSearch = studentLinkSearch.trim().toLocaleLowerCase("fr");
  const studentLinkSearchResults = useMemo(() => {
    return sortedLinkStudents.filter((student) => {
      const classLabel = student.option?.trim() ? `${student.className} ${student.option}` : student.className;
      const haystack = [
        student.nom,
        student.postnom,
        student.prenom,
        `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim(),
        student.matricule,
        classLabel,
      ]
        .join(" ")
        .toLocaleLowerCase("fr");
      return (!normalizedStudentLinkSearch || haystack.includes(normalizedStudentLinkSearch)) &&
        (!studentSectionFilter || student.section === studentSectionFilter) &&
        (!studentClassFilter || student.className === studentClassFilter);
    });
  }, [normalizedStudentLinkSearch, sortedLinkStudents, studentClassFilter, studentSectionFilter]);

  useEffect(() => {
    if (initializedRequestIdRef.current === requestId) return;
    initializedRequestIdRef.current = requestId;
    const parent = initialParentId ? yearData.parents.find((item) => item.id === initialParentId) : undefined;
    setForm(parent ?? { ...emptyParent(school.id, year.id), email: generatedParentEmail });
    setPassword("");
    setParentError("");
    setParentSuccess("");
    setShowParentPassword(false);
    setEmailManuallyEdited(false);
    setPasswordManuallyEdited(false);
    setStudentLinkSearch("");
    setStudentSelectorOpen(false);
    setStudentSectionFilter("");
    setStudentClassFilter("");
  }, [generatedParentEmail, initialParentId, requestId, school.id, year.id, yearData.parents]);

  useEffect(() => {
    if (!form.id.startsWith("new") || emailManuallyEdited || form.email) return;
    setForm((current) => (current.id.startsWith("new") && !current.email ? { ...current, email: generatedParentEmail } : current));
  }, [emailManuallyEdited, form.email, form.id, generatedParentEmail]);

  async function saveParentProfile() {
    setParentError("");
    setParentSuccess("");
    if (!form.fullName || !form.email || !form.phone) return;

    const isNew = form.id.startsWith("new");
    const parentId = isNew ? createId("parent") : form.id;
    const existingUser = data.users.find((item) => item.id === form.userId || item.parentId === parentId);
    if (isNew && !password) {
      setParentError("Mot de passe requis pour créer le compte Firebase Auth du parent.");
      return;
    }
    let userId = existingUser?.id ?? form.userId;
    if (isNew) {
      try {
        const provisioned = await provisionParent({
          schoolId: school.id,
          schoolYearId: year.id,
          parentId,
          name: form.fullName,
          email: form.email,
          password,
          phone: form.phone,
          address: form.address,
          studentIds: form.studentIds,
          status: form.status ?? "active",
        });
        userId = provisioned.user.id;
      } catch (error) {
        setParentError(error instanceof Error ? `Provisionnement parent impossible : ${error.message}` : "Provisionnement parent impossible.");
        return;
      }
    }
    if (!userId) {
      setParentError("Compte utilisateur parent introuvable. Modification du parent impossible sans recréer le compte.");
      return;
    }
    const parent: ParentProfile = {
      ...form,
      id: parentId,
      userId,
      schoolId: school.id,
      schoolYearId: year.id,
      status: form.status ?? "active",
      studentIds: form.studentIds,
    };
    const parentUser: AppUser = {
      id: userId,
      name: parent.fullName,
      email: parent.email,
      role: "parent",
      schoolId: school.id,
      activeSchoolYearId: year.id,
      parentId: parent.id,
      studentIds: parent.studentIds,
      status: parent.status,
      phone: parent.phone,
      address: parent.address,
    };
    const nextParents = isNew ? [...data.parents, parent] : data.parents.map((item) => (item.id === parent.id ? parent : item));
    const nextUsers = isNew ? [...data.users, parentUser] : existingUser ? data.users.map((item) => (item.id === userId ? { ...item, ...parentUser } : item)) : data.users;
    const nextStudents = data.students.map((student) => {
      if (parent.studentIds.includes(student.id)) return { ...student, parentId: parent.id };
      if (student.parentId === parent.id) return { ...student, parentId: undefined };
      return student;
    });

    if (isNew) {
      updateData({ parents: nextParents, users: nextUsers, students: nextStudents }, { persist: false });
    } else {
      updateData({ parents: nextParents, users: nextUsers, students: nextStudents });
    }
    setForm({ ...emptyParent(school.id, year.id), email: generatedParentEmail });
    setPassword("");
    setEmailManuallyEdited(false);
    setPasswordManuallyEdited(false);
    setStudentLinkSearch("");
    setStudentSelectorOpen(false);
    setStudentSectionFilter("");
    setStudentClassFilter("");
    if (isNew) {
      setParentSuccess("Compte parent créé avec succès. Il peut maintenant se connecter avec son email et son mot de passe.");
    }
  }

  function toggleLinkedStudent(studentId: string) {
    setForm((current) => ({
      ...current,
      studentIds: current.studentIds.includes(studentId) ? current.studentIds.filter((id) => id !== studentId) : [...current.studentIds, studentId],
    }));
  }

  function removeLinkedStudent(studentId: string) {
    setForm((current) => ({ ...current, studentIds: current.studentIds.filter((id) => id !== studentId) }));
  }

  return (
    <div className="grid min-w-0 gap-3">
      {showBackButton && onBack && (
        <button onClick={onBack} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white text-slate-600 transition hover:bg-slate-50 hover:text-ink" aria-label="Retour aux Parents / Tuteurs" title="Retour aux Parents / Tuteurs">
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      {parentError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{parentError}</p>}
      {parentSuccess && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{parentSuccess}</p>}
      <FormPanel title="">
        <Field label="Nom complet" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} />
        <Field
          label="Téléphone"
          value={form.phone}
          onChange={(value) => {
            setForm({ ...form, phone: value });
            if (form.id.startsWith("new")) setPassword(temporaryPasswordAfterPhoneChange({ nextPhone: value, currentPassword: password, manuallyEdited: passwordManuallyEdited }));
          }}
        />
        <Field
          label="Adresse e-mail"
          value={form.email}
          onChange={(value) => {
            setForm({ ...form, email: value });
            if (form.id.startsWith("new")) setEmailManuallyEdited(true);
          }}
          type="email"
        />
        <Field label="Adresse physique" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
        {form.id.startsWith("new") && (
          <PasswordField
            label="Mot de passe temporaire"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setPasswordManuallyEdited(true);
            }}
            visible={showParentPassword}
            onToggle={() => setShowParentPassword(!showParentPassword)}
          />
        )}
        <button type="button" onClick={() => setStudentSelectorOpen(true)} className="secondary-button w-full justify-center">
          <Link2 className="h-4 w-4" /> Lier à un élève <span className="font-normal text-slate-500">(facultatif)</span>
        </button>
        {studentSelectorOpen && (
          <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-slate-50 p-3" aria-label="Sélectionner les élèves à lier">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-ink">Sélectionner un ou plusieurs élèves</p>
              <button type="button" onClick={() => setStudentSelectorOpen(false)} className="rounded p-2 text-slate-500 hover:bg-white" aria-label="Fermer le sélecteur d'élèves"><X className="h-4 w-4" /></button>
            </div>
            <input value={studentLinkSearch} onChange={(event) => setStudentLinkSearch(event.target.value)} className="input" placeholder="Nom, matricule ou classe" />
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <select value={studentSectionFilter} onChange={(event) => { setStudentSectionFilter(event.target.value); setStudentClassFilter(""); }} className="input" aria-label="Filtrer par section">
                <option value="">Toutes les sections</option>
                {studentSections.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
              <select value={studentClassFilter} onChange={(event) => setStudentClassFilter(event.target.value)} className="input" aria-label="Filtrer par classe">
                <option value="">Toutes les classes</option>
                {studentClasses.map((className) => <option key={className} value={className}>{className}</option>)}
              </select>
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded border border-slate-200 bg-white p-2 scrollbar-thin">
            {studentLinkSearchResults.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun élève trouvé.</p>}
            {studentLinkSearchResults.map((student) => {
              const isSelected = form.studentIds.includes(student.id);
              const classLabel = student.option?.trim() ? `${student.className} ${student.option}` : student.className;
              return (
                <button
                  key={student.id}
                  onClick={() => toggleLinkedStudent(student.id)}
                  disabled={Boolean(student.parentId && student.parentId !== form.id)}
                  className={`w-full rounded border p-3 text-left text-sm transition ${
                    isSelected ? "border-blue-200 bg-blue-50" : student.parentId && student.parentId !== form.id ? "cursor-not-allowed border-slate-100 bg-slate-100 opacity-60" : "border-slate-100 bg-slate-50 hover:border-blue-200 hover:bg-blue-50"
                  }`}
                  type="button"
                >
                  <p className="font-semibold text-ink">{`${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim()}</p>
                  <p className="text-xs text-slate-500">
                    {classLabel}{student.matricule ? ` · ${student.matricule}` : ""}{student.parentId && student.parentId !== form.id ? " · déjà lié" : ""}
                  </p>
                </button>
              );
            })}
            </div>
          </section>
        )}
        {selectedLinkedStudents.length > 0 && (
          <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-ink">{selectedLinkedStudents.length} élève(s) lié(s)</p>
            <div className="grid gap-2">
              {selectedLinkedStudents.map((student) => {
                const classLabel = student.option?.trim() ? `${student.className} ${student.option}` : student.className;
                const studentLabel = `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();
                return (
                  <div key={student.id} className="flex min-w-0 items-center justify-between gap-3 rounded bg-white px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{studentLabel}</p>
                      <p className="truncate text-xs text-slate-500">{classLabel}{student.matricule ? ` · ${student.matricule}` : ""}</p>
                    </div>
                    <button
                      onClick={() => removeLinkedStudent(student.id)}
                      className="shrink-0 rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-red-600"
                      type="button"
                      aria-label={`Retirer ${studentLabel}`}
                    >
                      X
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <button
            onClick={() => {
              setForm({ ...emptyParent(school.id, year.id), email: generatedParentEmail });
              setPassword("");
              setEmailManuallyEdited(false);
              setPasswordManuallyEdited(false);
              setStudentLinkSearch("");
            }}
            className="secondary-button"
          >
            Annuler
          </button>
          <button onClick={saveParentProfile} className="primary-button"><CheckCircle2 className="h-4 w-4" /> Enregistrer</button>
        </div>
      </FormPanel>
    </div>
  );
}
