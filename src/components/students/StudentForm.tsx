import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, Fingerprint, Plus, Radio, X } from "lucide-react";
import { Field, ImageUploadField, PasswordField } from "../ui";
import { cardStatusLabels, fingerprintStatusLabels, resolveStudentBiometric } from "../../utils/biometrics";
import { getClassSection } from "../../utils/studentClasses";
import { resolveStudentParentClass, schoolClassRecordId, secondarySubclassesForOption, studentSchoolClassOptionKey, validateSubclassCreation } from "../../services/schoolSubclasses";
import { nextSubclassLetters } from "../../utils/subclassLetters.js";
import { deleteStudentBirthDateInput, formatStudentBirthDateInput, guideStudentBirthDateInput, parseStudentBirthDateInput } from "../../utils/studentBirthDate";
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
  onDeleteSubclass,
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
  onAddSubclasses?: (parent: SchoolClassRecord, labels: string[], classOptionKey: string | undefined, confirmation: string) => Promise<void>;
  onDeleteSubclass?: (subclass: SchoolClassRecord, confirmation: string) => Promise<void>;
}) {
  const [showOptionForm, setShowOptionForm] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [showQuickParentPassword, setShowQuickParentPassword] = useState(false);
  const [showFingerprintMessage, setShowFingerprintMessage] = useState(false);
  const [showCardMessage, setShowCardMessage] = useState(false);
  const [fingerprintMessageTrigger, setFingerprintMessageTrigger] = useState(0);
  const [cardMessageTrigger, setCardMessageTrigger] = useState(0);
  const [birthDateInput, setBirthDateInput] = useState(() => formatStudentBirthDateInput(form.birthDate));
  const [birthDateError, setBirthDateError] = useState("");
  const birthDateRef = useRef<HTMLInputElement>(null);
  const birthDateCaretRef = useRef<number | null>(null);

  function changeBirthDate(value: string, caret: number) {
    const parsed = parseStudentBirthDateInput(value);
    birthDateCaretRef.current = caret;
    setBirthDateInput(value);
    setBirthDateError(parsed === null && value.length === 10 ? "Saisissez une date valide au format jj/mm/aaaa." : "");
    if (parsed !== null) setForm({ ...form, birthDate: parsed });
  }

  useLayoutEffect(() => {
    if (birthDateCaretRef.current === null) return;
    birthDateRef.current?.setSelectionRange(birthDateCaretRef.current, birthDateCaretRef.current);
    birthDateCaretRef.current = null;
  }, [birthDateInput]);
  const [subclassMode, setSubclassMode] = useState<"add" | "delete" | null>(null);
  const [subclassLabels, setSubclassLabels] = useState<string[]>([]);
  const [subclassError, setSubclassError] = useState("");
  const [showEmptySubclassMessage, setShowEmptySubclassMessage] = useState(false);
  const [emptySubclassMessageTrigger, setEmptySubclassMessageTrigger] = useState(0);
  const [subclassAddConfirmation, setSubclassAddConfirmation] = useState("");
  const [subclassAddPending, setSubclassAddPending] = useState(false);
  const [subclassAddSaving, setSubclassAddSaving] = useState(false);
  const [subclassDeleteTarget, setSubclassDeleteTarget] = useState<SchoolClassRecord>();
  const [subclassDeleteConfirmation, setSubclassDeleteConfirmation] = useState("");
  const [subclassDeletePending, setSubclassDeletePending] = useState(false);
  const subclassControlsRef = useRef<HTMLDivElement>(null);
  const [parentQuery, setParentQuery] = useState("");
  const normalizedParentQuery = parentQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr");
  const visibleParents = parents.filter((parent) => !normalizedParentQuery || `${parent.fullName} ${parent.phone}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").includes(normalizedParentQuery));
  const selectedStructuredClass = resolveStudentParentClass(structuredClasses, form);
  const selectedClass = selectedStructuredClass ?? (form.className ? { id: schoolClassRecordId(form.schoolId, form.schoolYearId, form.className), schoolId: form.schoolId, schoolYearId: form.schoolYearId, name: form.className, active: true } : undefined);
  const isSecondaryClass = getClassSection(form.className) === "Secondaire";
  const selectedOptionKey = studentSchoolClassOptionKey(structuredClasses, form);
  const subclasses = selectedClass
    ? isSecondaryClass
      ? secondarySubclassesForOption(structuredClasses, selectedClass.id, selectedOptionKey, form.subClassId)
      : structuredClasses.filter((item) => item.parentClassId === selectedClass.id && item.active !== false)
    : [];
  const existingSubclassLabels = selectedClass ? structuredClasses.filter((item) => item.schoolId === selectedClass.schoolId
    && item.schoolYearId === selectedClass.schoolYearId && item.parentClassId === selectedClass.id
    && item.active !== false && (item.classOptionKey ?? "") === (selectedOptionKey ?? ""))
    .map((item) => item.subClassLabel ?? "") : [];
  const canAddSubclass = Boolean(selectedClass && onAddSubclasses && (!isSecondaryClass || selectedOptionKey));
  const biometric = resolveStudentBiometric(form);

  const resetSubclassContext = useCallback(() => {
    setSubclassMode(null);
    setSubclassLabels([]);
    setSubclassError("");
    setShowEmptySubclassMessage(false);
    setSubclassAddConfirmation("");
    setSubclassAddPending(false);
    setSubclassAddSaving(false);
    setSubclassDeleteTarget(undefined);
    setSubclassDeleteConfirmation("");
    setSubclassDeletePending(false);
  }, []);

  useEffect(() => { resetSubclassContext(); }, [form.schoolId, form.schoolYearId, form.classId, form.className, selectedOptionKey, resetSubclassContext]);

  useEffect(() => {
    setBirthDateInput(formatStudentBirthDateInput(form.birthDate));
    setBirthDateError("");
  }, [form.birthDate, form.id]);

  useEffect(() => {
    if (!subclassMode) return undefined;
    const onOutsidePointerDown = (event: PointerEvent) => {
      if (subclassAddSaving || subclassDeletePending || subclassControlsRef.current?.contains(event.target as Node)) return;
      resetSubclassContext();
    };
    document.addEventListener("pointerdown", onOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown);
  }, [subclassMode, subclassAddSaving, subclassDeletePending, resetSubclassContext]);

  function toggleAddSubclass() {
    if (subclassMode === "add") { resetSubclassContext(); return; }
    resetSubclassContext();
    setSubclassLabels(nextSubclassLetters(existingSubclassLabels, existingSubclassLabels.length ? 1 : 2));
    setSubclassMode("add");
  }

  function toggleDeleteSubclass() {
    if (subclassMode === "delete") { resetSubclassContext(); return; }
    resetSubclassContext();
    if (subclasses.length === 0) {
      setShowEmptySubclassMessage(true);
      setEmptySubclassMessageTrigger((trigger) => trigger + 1);
      return;
    }
    setSubclassMode("delete");
  }

  useEffect(() => {
    if (emptySubclassMessageTrigger === 0) return undefined;
    const timer = window.setTimeout(() => setShowEmptySubclassMessage(false), 4000);
    return () => window.clearTimeout(timer);
  }, [emptySubclassMessageTrigger]);

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
        if (parseStudentBirthDateInput(birthDateInput) === null) {
          setBirthDateError("Saisissez une date valide au format jj/mm/aaaa.");
          return;
        }
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
      <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
        Date de naissance
        <input
          ref={birthDateRef}
          value={birthDateInput}
          onChange={(event) => {
            const raw = event.target.value;
            changeBirthDate(guideStudentBirthDateInput(raw), guideStudentBirthDateInput(raw.slice(0, event.target.selectionStart ?? raw.length)).length);
          }}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === "Backspace" || event.key === "Delete") {
              event.preventDefault();
              const edit = deleteStudentBirthDateInput(birthDateInput, event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0, event.key === "Backspace");
              changeBirthDate(edit.value, edit.caret);
            } else if (event.key.length === 1 && !/^[0-9]$/.test(event.key)) event.preventDefault();
          }}
          onBeforeInput={(event) => {
            const input = event.nativeEvent as InputEvent;
            if (input.inputType === "deleteContentBackward" || input.inputType === "deleteContentForward") {
              event.preventDefault();
              const edit = deleteStudentBirthDateInput(birthDateInput, event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0, input.inputType === "deleteContentBackward");
              changeBirthDate(edit.value, edit.caret);
            } else if (input.data && /[^0-9]/.test(input.data)) event.preventDefault();
          }}
          onPaste={(event) => {
            event.preventDefault();
            const input = event.currentTarget;
            const start = input.selectionStart ?? 0;
            const end = input.selectionEnd ?? start;
            const inserted = event.clipboardData.getData("text").replace(/[^0-9]/g, "");
            const prefix = birthDateInput.slice(0, start);
            changeBirthDate(guideStudentBirthDateInput(prefix + inserted + birthDateInput.slice(end)), guideStudentBirthDateInput(prefix + inserted).length);
          }}
          type="text"
          inputMode="numeric"
          autoComplete="bday"
          placeholder="jj/mm/aaaa"
          maxLength={10}
          pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
          aria-describedby={birthDateError ? "student-birth-date-error" : undefined}
          aria-invalid={Boolean(birthDateError)}
          className="input"
        />
        {birthDateError && <span id="student-birth-date-error" role="alert" className="text-sm font-medium text-red-700">{birthDateError}</span>}
      </label>
      <Field label="Adresse" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Classe
        <select value={form.className} disabled={subclassAddSaving || subclassDeletePending} onChange={(event) => { const selected = structuredClasses.find((item) => !item.parentClassId && item.active !== false && item.name === event.target.value); resetSubclassContext(); setForm({ ...form, classId: selected?.id, className: event.target.value as SchoolClass, option: undefined, classOptionKey: undefined, subClassId: undefined }); }} className="input">
          {classChoices.map((className) => <option key={className} value={className}>{className}</option>)}
        </select>
      </label>
      {isSecondaryClass && (
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Option
            <select
              value={optionChoices.includes(form.option ?? "") ? form.option : ""}
              disabled={subclassAddSaving || subclassDeletePending}
              onChange={(event) => {
                if (event.target.value === "__add_option__") {
                  setShowOptionForm(true);
                  return;
                }
                const option = event.target.value || undefined;
                const nextForm = { ...form, option, subClassId: undefined };
                resetSubclassContext();
                setForm({ ...nextForm, classOptionKey: studentSchoolClassOptionKey(structuredClasses, nextForm) });
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
      {!selectedClass && <p className="text-xs text-slate-500">Sélectionnez d’abord une classe principale pour ajouter des sous-classes.</p>}
      {selectedClass && isSecondaryClass && !selectedOptionKey && <p className="text-xs text-slate-500">Sélectionnez d’abord une option pour ajouter ou choisir ses sous-classes.</p>}
      {selectedClass && subclasses.length > 0 && <label className="grid gap-1 text-sm font-medium text-slate-700">Sous-classe<select className="input" required disabled={subclassAddSaving || subclassDeletePending} value={form.subClassId ?? ""} onChange={(event) => setForm({ ...form, subClassId: event.target.value || undefined })}><option value="">Choisir une sous-classe</option>{subclasses.map((item) => <option key={item.id} value={item.id}>{item.subClassLabel ?? item.name}</option>)}</select></label>}
      <div ref={subclassControlsRef} className="grid min-w-0 gap-2">
        {showEmptySubclassMessage && <p role="alert" className="text-sm font-medium text-red-700">Cette classe n'a pas de sous-classe</p>}
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <button type="button" className="secondary-button w-full min-w-0 whitespace-normal px-2 text-center leading-tight" disabled={!canAddSubclass || subclassAddSaving || subclassDeletePending} title={!selectedClass ? "Sélectionnez d’abord une classe principale." : isSecondaryClass && !selectedOptionKey ? "Sélectionnez d’abord une option." : undefined} onClick={toggleAddSubclass}>Ajouter sous-classe</button>
          <button type="button" className="secondary-button w-full min-w-0 whitespace-normal px-2 text-center leading-tight" disabled={!selectedClass || !onDeleteSubclass || subclassAddSaving || subclassDeletePending} onClick={toggleDeleteSubclass}>Supp. sous-classe</button>
        </div>
        {subclassMode === "add" && selectedClass && onAddSubclasses && canAddSubclass && <section className="grid min-w-0 gap-2 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="font-semibold">Sous-classes de {selectedClass.name}{form.option ? ` — ${form.option}` : ""}</p>
          {subclassLabels.map((label, index) => <input key={index} className="input min-w-0" aria-label={`Sous-classe ${index + 1}`} value={label} readOnly />)}
          {!subclassAddPending && <><button type="button" className="secondary-button justify-center" disabled={subclassLabels.length >= 20} onClick={() => setSubclassLabels((items) => [...items, ...nextSubclassLetters([...existingSubclassLabels, ...items])])}>Ajouter une autre sous-classe</button>
            {subclassError && <p role="alert" className="text-sm text-red-700">{subclassError}</p>}
            <button type="button" className="primary-button justify-center" onClick={() => { const error = validateSubclassCreation(subclassLabels, structuredClasses, selectedClass, selectedOptionKey); if (error) { setSubclassError(error); return; } if (subclassLabels.some((label, index) => label !== nextSubclassLetters(existingSubclassLabels, subclassLabels.length)[index])) { setSubclassError("Les sous-classes ont changé. Rouvrez le formulaire."); return; } setSubclassError(""); setSubclassAddConfirmation(""); setSubclassAddPending(true); }}>Enregistrer les sous-classes</button></>}
          {subclassAddPending && <div role="dialog" aria-label="Confirmer l'ajout de sous-classe" className="grid min-w-0 gap-2 rounded border border-amber-200 bg-amber-50 p-3"><p>Saisissez exactement <strong>AJOUTER CETTE SOUS-CLASSE</strong> pour confirmer l’ajout à {selectedClass.name}.</p><input className="input min-w-0" aria-label="Confirmation de l'ajout" value={subclassAddConfirmation} onChange={(event) => setSubclassAddConfirmation(event.target.value)} /><div className="grid min-w-0 grid-cols-2 gap-2"><button type="button" className="secondary-button w-full min-w-0 whitespace-normal px-2 text-center" disabled={subclassAddSaving} onClick={resetSubclassContext}>Annuler</button><button type="button" className="primary-button w-full min-w-0 whitespace-normal px-2 text-center" disabled={subclassAddSaving || subclassAddConfirmation !== "AJOUTER CETTE SOUS-CLASSE"} onClick={() => { setSubclassAddSaving(true); void onAddSubclasses(selectedClass, subclassLabels, selectedOptionKey, subclassAddConfirmation).then(resetSubclassContext).catch((cause) => setSubclassError(cause instanceof Error ? cause.message : "Création impossible.")).finally(() => setSubclassAddSaving(false)); }}>Confirmer l’ajout</button></div>{subclassError && <p role="alert" className="text-sm text-red-700">{subclassError}</p>}</div>}
        </section>}
        {subclassMode === "delete" && selectedClass && onDeleteSubclass && <ul className="grid min-w-0 gap-1" aria-label="Sous-classes existantes">{subclasses.map((item) => <li key={item.id} className="grid min-w-0 gap-2 rounded border border-slate-200 p-2 text-sm"><div className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0 break-words">{item.subClassLabel ?? item.name}</span><button type="button" className="shrink-0 rounded p-2 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600" aria-label={`Supprimer la sous-classe ${item.subClassLabel ?? item.name}`} onClick={() => { setSubclassDeleteTarget(item); setSubclassDeleteConfirmation(""); setSubclassError(""); }}><X className="h-4 w-4" /></button></div>
          {subclassDeleteTarget?.id === item.id && <div role="dialog" aria-label="Confirmer la suppression de sous-classe" className="grid min-w-0 gap-2 rounded border border-red-200 bg-red-50 p-3"><p>Supprimer la sous-classe <strong>{item.subClassLabel ?? item.name}</strong> de {selectedClass.name} ?</p><p>Saisissez exactement <strong>SUPPRIMER CETTE SOUS-CLASSE</strong>.</p><input className="input min-w-0" aria-label="Confirmation de la suppression" value={subclassDeleteConfirmation} onChange={(event) => setSubclassDeleteConfirmation(event.target.value)} /><div className="grid min-w-0 grid-cols-2 gap-2"><button type="button" className="secondary-button w-full min-w-0 whitespace-normal px-2 text-center" disabled={subclassDeletePending} onClick={() => { setSubclassDeleteTarget(undefined); setSubclassDeleteConfirmation(""); setSubclassError(""); }}>Annuler</button><button type="button" className="primary-button w-full min-w-0 whitespace-normal px-2 text-center" disabled={subclassDeletePending || subclassDeleteConfirmation !== "SUPPRIMER CETTE SOUS-CLASSE"} onClick={() => { setSubclassDeletePending(true); void onDeleteSubclass(item, subclassDeleteConfirmation).then(() => { if (form.subClassId === item.id) setForm({ ...form, subClassId: undefined }); resetSubclassContext(); }).catch((cause) => setSubclassError(cause instanceof Error ? cause.message : "Suppression impossible.")).finally(() => setSubclassDeletePending(false)); }}>Supprimer définitivement</button></div>{subclassError && <p role="alert" className="text-sm text-red-700">{subclassError}</p>}</div>}
        </li>)}</ul>}
      </div>
      <ImageUploadField label="Photo de l'élève" value={form.photoUrl ?? ""} onChange={(value) => setForm({ ...form, photoUrl: value })} maxWidth={800} maxBytes={300 * 1024} />
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
          <input value={quickParent.phone} onChange={(event) => {
            const phone = event.target.value;
            setQuickParent({ ...quickParent, phone, password: !quickParent.password || quickParent.password === quickParent.phone ? phone : quickParent.password });
          }} className="input" placeholder="Téléphone" />
          <input value={quickParent.email} onChange={(event) => setQuickParent({ ...quickParent, email: event.target.value })} className="input" placeholder="Email" />
          <PasswordField label="Mot de passe temporaire" value={quickParent.password} onChange={(value) => setQuickParent({ ...quickParent, password: value })} visible={showQuickParentPassword} onToggle={() => setShowQuickParentPassword(!showQuickParentPassword)} placeholder="Mot de passe temporaire" />
          {quickParentFeedback && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm font-semibold text-emerald-700">{quickParentFeedback}</p>}
          <button onClick={onCreateParent} className="primary-button" type="button"><Plus className="h-4 w-4" /> Créer et sélectionner</button>
        </div>
      </div>}
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
