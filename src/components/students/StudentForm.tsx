import { useEffect, useState } from "react";
import { CheckCircle2, Fingerprint, Plus, Radio } from "lucide-react";
import { Field, ImageUploadField, PasswordField } from "../ui";
import { cardStatusLabels, fingerprintStatusLabels, resolveStudentBiometric } from "../../utils/biometrics";
import { getClassSection } from "../../utils/studentClasses";
import { schoolClassOptionKey, schoolClassRecordId, secondarySubclassesForOption } from "../../services/schoolSubclasses";
import type { ParentProfile, SchoolClass, SchoolClassRecord, Student } from "../../types";

export function StudentForm({
  form,
  setForm,
  parents,
  pendingParent,
  quickParent,
  quickParentFeedback,
  setQuickParent,
  classChoices,
  optionChoices,
  onAddOption,
  onCreateParent,
  onSave,
  onReset,
  errorMessage,
  isSaving = false,
  canCreateParent = true,
  canAddOption = true,
  structuredClasses = [],
  onAddSubclasses,
}: {
  form: Student;
  setForm: (student: Student) => void;
  parents: ParentProfile[];
  pendingParent?: { id: string; fullName: string; phone: string };
  quickParent: { fullName: string; phone: string; email: string; password: string };
  quickParentFeedback?: string;
  setQuickParent: (parent: { fullName: string; phone: string; email: string; password: string }) => void;
  classChoices: SchoolClass[];
  optionChoices: string[];
  onAddOption: (option: string) => void;
  onCreateParent: () => void;
  onSave: () => void | Promise<void>;
  onReset: () => void;
  errorMessage?: string;
  isSaving?: boolean;
  canCreateParent?: boolean;
  canAddOption?: boolean;
  structuredClasses?: SchoolClassRecord[];
  onAddSubclasses?: (parent: SchoolClassRecord, labels: string[], classOptionKey?: string) => Promise<void>;
}) {
  const [showOptionForm, setShowOptionForm] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [showQuickParentPassword, setShowQuickParentPassword] = useState(false);
  const [showFingerprintMessage, setShowFingerprintMessage] = useState(false);
  const [showCardMessage, setShowCardMessage] = useState(false);
  const [fingerprintMessageTrigger, setFingerprintMessageTrigger] = useState(0);
  const [cardMessageTrigger, setCardMessageTrigger] = useState(0);
  const [subclassOpen, setSubclassOpen] = useState(false);
  const [subclassLabels, setSubclassLabels] = useState(["A", "B"]);
  const [subclassError, setSubclassError] = useState("");
  const [parentQuery, setParentQuery] = useState("");
  const normalizedParentQuery = parentQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr");
  const visibleParents = parents.filter((parent) => !normalizedParentQuery || `${parent.fullName} ${parent.phone}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").includes(normalizedParentQuery));
  const selectedStructuredClass = structuredClasses.find((item) => !item.parentClassId && (item.id === form.classId || item.name === form.className));
  const selectedClass = selectedStructuredClass ?? (form.className ? { id: schoolClassRecordId(form.schoolId, form.schoolYearId, form.className), schoolId: form.schoolId, schoolYearId: form.schoolYearId, name: form.className, active: true } : undefined);
  const isSecondaryClass = getClassSection(form.className) === "Secondaire";
  const selectedOptionKey = selectedClass && form.option ? schoolClassOptionKey(selectedClass.id, form.option) : undefined;
  const subclasses = selectedClass
    ? isSecondaryClass
      ? secondarySubclassesForOption(structuredClasses, selectedClass.id, selectedOptionKey, form.subClassId)
      : structuredClasses.filter((item) => item.parentClassId === selectedClass.id && item.active !== false)
    : [];
  const canAddSubclass = Boolean(selectedClass && onAddSubclasses && (!isSecondaryClass || selectedOptionKey));
  const biometric = resolveStudentBiometric(form);

  useEffect(() => {
    if (fingerprintMessageTrigger === 0) return undefined;
    const timer = window.setTimeout(() => setShowFingerprintMessage(false), 4000);
    return () => window.clearTimeout(timer);
  }, [fingerprintMessageTrigger]);

  useEffect(() => {
    if (cardMessageTrigger === 0) return undefined;
    const timer = window.setTimeout(() => setShowCardMessage(false), 4000);
    return () => window.clearTimeout(timer);
  }, [cardMessageTrigger]);

  function submitOption() {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    onAddOption(trimmed);
    setNewOption("");
    setShowOptionForm(false);
  }

  return (
    <form
      className="grid gap-3"
      aria-busy={isSaving}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <Field label="Matricule" value={form.matricule || "Généré automatiquement"} onChange={() => undefined} disabled />
      <Field label="Nom" value={form.nom} onChange={(value) => setForm({ ...form, nom: value })} />
      <Field label="Postnom" value={form.postnom} onChange={(value) => setForm({ ...form, postnom: value })} />
      <Field label="Prénom" value={form.prenom} onChange={(value) => setForm({ ...form, prenom: value })} />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Sexe
        <select value={form.sexe} onChange={(event) => setForm({ ...form, sexe: event.target.value as "M" | "F" })} className="input">
          <option value="M">M</option>
          <option value="F">F</option>
        </select>
      </label>
      <Field label="Date de naissance" value={form.birthDate} onChange={(value) => setForm({ ...form, birthDate: value })} type="date" />
      <Field label="Adresse" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Parent
        <input value={parentQuery} onChange={(event) => setParentQuery(event.target.value)} className="input" placeholder="Rechercher un parent par nom" aria-label="Rechercher un parent" />
        <select value={form.parentId ?? ""} onChange={(event) => setForm({ ...form, parentId: event.target.value || undefined })} className="input">
          <option value="">Aucun parent lié</option>
          {pendingParent && <option value={pendingParent.id}>{pendingParent.fullName} - {pendingParent.phone} (création en attente)</option>}
          {visibleParents.map((parent) => (
            <option key={parent.id} value={parent.id}>{parent.fullName} - {parent.phone}</option>
          ))}
        </select>
        {visibleParents.length === 0 && <span className="rounded bg-slate-50 p-2 text-sm font-normal text-slate-500">Aucun parent trouvé.</span>}
      </label>
      {canCreateParent && <div className="rounded border border-slate-100 bg-slate-50 p-3">
        <p className="mb-2 text-sm font-semibold text-ink">Créer un parent sans quitter la fiche</p>
        <div className="grid gap-2">
          <input value={quickParent.fullName} onChange={(event) => setQuickParent({ ...quickParent, fullName: event.target.value })} className="input" placeholder="Nom complet" />
          <input
            value={quickParent.phone}
            onChange={(event) => {
              const phone = event.target.value;
              setQuickParent({ ...quickParent, phone, password: !quickParent.password || quickParent.password === quickParent.phone ? phone : quickParent.password });
            }}
            className="input"
            placeholder="Téléphone"
          />
          <input value={quickParent.email} onChange={(event) => setQuickParent({ ...quickParent, email: event.target.value })} className="input" placeholder="Email" />
          <PasswordField
            label="Mot de passe temporaire"
            value={quickParent.password}
            onChange={(value) => setQuickParent({ ...quickParent, password: value })}
            visible={showQuickParentPassword}
            onToggle={() => setShowQuickParentPassword(!showQuickParentPassword)}
            placeholder="Mot de passe temporaire"
          />
          {quickParentFeedback && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm font-semibold text-emerald-700">{quickParentFeedback}</p>}
          <button onClick={onCreateParent} className="primary-button" type="button"><Plus className="h-4 w-4" /> Créer et sélectionner</button>
        </div>
      </div>}
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Classe
        <select value={form.classId || form.className} onChange={(event) => { const selected = structuredClasses.find((item) => item.id === event.target.value); setForm({ ...form, classId: selected?.id, className: (selected?.name ?? event.target.value) as SchoolClass, option: undefined, classOptionKey: undefined, subClassId: undefined }); }} className="input">
          {structuredClasses.filter((item) => !item.parentClassId && item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          {classChoices.map((className) => (
            structuredClasses.some((item) => !item.parentClassId && item.name === className) ? null : <option key={className} value={className}>{className}</option>
          ))}
        </select>
      </label>
      {isSecondaryClass && (
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Option
            <select
              value={optionChoices.includes(form.option ?? "") ? form.option : ""}
              onChange={(event) => {
                if (event.target.value === "__add_option__") {
                  setShowOptionForm(true);
                  return;
                }
                const option = event.target.value || undefined;
                setForm({ ...form, option, classOptionKey: selectedClass && option ? schoolClassOptionKey(selectedClass.id, option) : undefined, subClassId: undefined });
              }}
              className="input"
            >
              <option value="">Aucune option</option>
              {optionChoices.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
              {canAddOption && <option value="__add_option__">Ajouter une option</option>}
            </select>
          </label>
          {canAddOption && showOptionForm && (
            <div className="rounded border border-slate-100 bg-slate-50 p-3">
              <p className="mb-2 text-sm font-semibold text-ink">Nouvelle option</p>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input value={newOption} onChange={(event) => setNewOption(event.target.value)} className="input" placeholder="Nom de l'option" />
                <button onClick={submitOption} type="button" className="secondary-button justify-center">
                  <Plus className="h-4 w-4" /> Ajouter
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <button type="button" className="secondary-button justify-center" disabled={!canAddSubclass} title={!selectedClass ? "Sélectionnez d’abord une classe principale." : isSecondaryClass && !selectedOptionKey ? "Sélectionnez d’abord une option." : undefined} onClick={() => setSubclassOpen((open) => !open)}><Plus className="h-4 w-4" /> Ajouter sous-classe</button>
      {!selectedClass && <p className="text-xs text-slate-500">Sélectionnez d’abord une classe principale pour ajouter des sous-classes.</p>}
      {selectedClass && isSecondaryClass && !selectedOptionKey && <p className="text-xs text-slate-500">Sélectionnez d’abord une option pour ajouter ou choisir ses sous-classes.</p>}
      {selectedClass && subclasses.length >= 2 && <label className="grid gap-1 text-sm font-medium text-slate-700">Sous-classe <span className="text-red-700">obligatoire</span><select className="input" required value={form.subClassId ?? ""} onChange={(event) => setForm({ ...form, subClassId: event.target.value || undefined })}><option value="">Choisir une sous-classe</option>{subclasses.map((item) => <option key={item.id} value={item.id}>{item.subClassLabel ?? item.name}</option>)}</select></label>}
      {subclassOpen && selectedClass && onAddSubclasses && canAddSubclass && <section className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3"><p className="font-semibold">Sous-classes de {selectedClass.name}{form.option ? ` — ${form.option}` : ""}</p>{subclassLabels.map((label, index) => <input key={index} className="input" aria-label={`Sous-classe ${index + 1}`} value={label} onChange={(event) => setSubclassLabels((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />)}<button type="button" className="secondary-button justify-center" onClick={() => setSubclassLabels((items) => [...items, ""])}>Ajouter une autre sous-classe</button>{subclassError && <p role="alert" className="text-sm text-red-700">{subclassError}</p>}<button type="button" className="primary-button justify-center" onClick={() => void onAddSubclasses(selectedClass, subclassLabels, selectedOptionKey).then(() => { setSubclassOpen(false); setSubclassLabels(["A", "B"]); setSubclassError(""); }).catch((cause) => setSubclassError(cause instanceof Error ? cause.message : "Création impossible."))}>Enregistrer les sous-classes</button></section>}
      <ImageUploadField label="Photo de l'élève" value={form.photoUrl ?? ""} onChange={(value) => setForm({ ...form, photoUrl: value })} maxWidth={800} maxBytes={300 * 1024} />
      <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <h3 className="break-words text-base font-bold text-ink">Identification biométrique</h3>
        <div className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-3 rounded border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center gap-2 font-semibold text-ink"><Fingerprint className="h-4 w-4" /> Empreinte</div>
            <p className="text-sm text-slate-600">Statut : <span className="font-semibold text-ink">{fingerprintStatusLabels[biometric.fingerprintStatus]}</span></p>
            <div className={`grid transition-all duration-300 ${showFingerprintMessage ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} aria-hidden={!showFingerprintMessage}>
              <p className="overflow-hidden rounded border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-800"><span className="block py-3">Fonction disponible après connexion d’un terminal ZKTeco via Acadéa Sync.</span></p>
            </div>
            <button type="button" className="secondary-button justify-center" onClick={() => { setShowFingerprintMessage(true); setFingerprintMessageTrigger((trigger) => trigger + 1); }}>
              <Fingerprint className="h-4 w-4" /> Enregistrer l’empreinte
            </button>
          </div>
          <div className="grid min-w-0 gap-3 rounded border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center gap-2 font-semibold text-ink"><Radio className="h-4 w-4" /> Carte RFID</div>
            <p className="text-sm text-slate-600">Statut : <span className="font-semibold text-ink">{cardStatusLabels[biometric.cardStatus]}</span></p>
            <label className="flex min-w-0 items-center gap-3 text-sm font-medium text-slate-700"><span className="shrink-0 font-semibold">UID</span><input className="input min-w-0 flex-1" value={biometric.cardUid ?? "Non attribué"} disabled readOnly /></label>
            <div className={`grid transition-all duration-300 ${showCardMessage ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} aria-hidden={!showCardMessage}>
              <p className="overflow-hidden rounded border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-800"><span className="block py-3">Fonction disponible après connexion d’un terminal ZKTeco via Acadéa Sync.</span></p>
            </div>
            <button type="button" className="secondary-button justify-center" onClick={() => { setShowCardMessage(true); setCardMessageTrigger((trigger) => trigger + 1); }}>
              <Radio className="h-4 w-4" /> Associer une carte
            </button>
          </div>
        </div>
      </section>
      {errorMessage && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{errorMessage}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onReset} className="secondary-button" type="button" disabled={isSaving}>Réinitialiser</button>
        <button className="primary-button" type="submit" disabled={isSaving}>
          <CheckCircle2 className="h-4 w-4" /> {isSaving ? "Enregistrement…" : "Sauver"}
        </button>
      </div>
    </form>
  );
}
