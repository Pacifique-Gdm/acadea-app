import { useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { Field, ImageUploadField, PasswordField } from "../ui";
import { getClassSection } from "../../utils/studentClasses";
import type { ParentProfile, SchoolClass, Student } from "../../types";

export function StudentForm({
  form,
  setForm,
  parents,
  quickParent,
  setQuickParent,
  classChoices,
  optionChoices,
  onAddOption,
  onCreateParent,
  onSave,
  onReset,
  errorMessage,
}: {
  form: Student;
  setForm: (student: Student) => void;
  parents: ParentProfile[];
  quickParent: { fullName: string; phone: string; email: string; password: string };
  setQuickParent: (parent: { fullName: string; phone: string; email: string; password: string }) => void;
  classChoices: SchoolClass[];
  optionChoices: string[];
  onAddOption: (option: string) => void;
  onCreateParent: () => void;
  onSave: () => void;
  onReset: () => void;
  errorMessage?: string;
}) {
  const [showOptionForm, setShowOptionForm] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [showQuickParentPassword, setShowQuickParentPassword] = useState(false);

  function submitOption() {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    onAddOption(trimmed);
    setNewOption("");
    setShowOptionForm(false);
  }

  return (
    <>
      {errorMessage && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{errorMessage}</p>}
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
        <select value={form.parentId ?? ""} onChange={(event) => setForm({ ...form, parentId: event.target.value || undefined })} className="input">
          <option value="">Aucun parent lié</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>{parent.fullName} - {parent.phone}</option>
          ))}
        </select>
      </label>
      <div className="rounded border border-slate-100 bg-slate-50 p-3">
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
          <button onClick={onCreateParent} className="primary-button" type="button"><Plus className="h-4 w-4" /> Créer et sélectionner</button>
        </div>
      </div>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Classe
        <select value={form.className} onChange={(event) => setForm({ ...form, className: event.target.value as SchoolClass })} className="input">
          {classChoices.map((className) => (
            <option key={className} value={className}>{className}</option>
          ))}
        </select>
      </label>
      {getClassSection(form.className) === "secondaire" && (
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
                setForm({ ...form, option: event.target.value || undefined });
              }}
              className="input"
            >
              <option value="">Aucune option</option>
              {optionChoices.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
              <option value="__add_option__">Ajouter une option</option>
            </select>
          </label>
          {showOptionForm && (
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
      <ImageUploadField label="Photo de l'élève" value={form.photoUrl ?? ""} onChange={(value) => setForm({ ...form, photoUrl: value })} maxWidth={800} maxBytes={300 * 1024} />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onReset} className="secondary-button">Réinitialiser</button>
        <button onClick={onSave} className="primary-button"><CheckCircle2 className="h-4 w-4" /> Sauver</button>
      </div>
    </>
  );
}
