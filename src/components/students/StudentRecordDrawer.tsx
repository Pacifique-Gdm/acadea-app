import { useEffect, useRef, useState } from "react";
import { StudentForm } from "./StudentForm";
import { AdminDrawer } from "../ui";
import { createSchoolSubclasses, linkParentToStudent, provisionParent, requestSchoolSubclassDeletion, saveManualStudent, unlinkParentFromStudent } from "../../services/provisioning";
import { nextParentEmail, parentEmailExists } from "../../utils/parents";
import { applyParentLinkResult, applyParentUnlinkResult, PARENT_LINK_CONFIRMATION, PARENT_UNLINK_CONFIRMATION, studentBeforeParentMutation } from "../../utils/parentStudentLink";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../../utils/schoolOptions";
import { persistSchoolOption } from "../../services/schoolOptionsRepository";
import { getClassSection } from "../../utils/studentClasses";
import { emptyStudent, studentForPersistence, validateStudentForSave } from "../../utils/studentUtils";
import type { AppData, ParentProfile, School, SchoolClass, SchoolClassRecord, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";
import { resolveStudentParentClass, schoolClassOptionKey, studentSchoolClassOptionKey, subscribeToSchoolClasses, validateStudentAcademicSelection } from "../../services/schoolSubclasses";
import { failureKind, plainFailureMessage, publicServerMessage } from "../../services/requestFailure";
import { discardUploadedPhotoIfUnused, findSavedStudent } from "../../services/studentSaveVerification";
import { needsStorageUpload, uploadStudentPhoto } from "../../services/studentPhotoStorage";
import { userFacingError } from "../../utils/userFacingError";
import { waitForCondition } from "../../utils/waitForCondition";

/** Droits de la fiche élève officielle (création, modification, parent, options et sous-classes). */
export interface StudentRecordCapabilities {
  canCreate: boolean;
  canEdit: boolean;
  canCreateParent: boolean;
  canManageOptions: boolean;
}

/** Fiche à ouvrir : un nouvel élève, ou un élève existant à modifier. */
export type StudentRecordTarget = { mode: "create" } | { mode: "edit"; student: Student };

type PendingQuickParent = { parentId: string; fullName: string; phone: string; email: string; password: string };
type QuickParentForm = { fullName: string; phone: string; email: string; password: string };

function emptyQuickParent(email = ""): QuickParentForm {
  return { fullName: "", phone: "", email, password: "" };
}

/** Fiche élève officielle, la même partout : Élèves (secrétariat, administrateur) et paiement du caissier. */
export function StudentRecordDrawer({
  data, school, year, updateData, uid, target, capabilities, studentRecords, parents, classChoices,
  structuredClasses: providedClasses, structuredClassesLoaded: providedClassesLoaded, loadError = "", onClose, onSaved,
}: {
  data: AppData;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  uid: (prefix: string) => string;
  target: StudentRecordTarget;
  capabilities: StudentRecordCapabilities;
  studentRecords: Student[];
  parents: ParentProfile[];
  classChoices: SchoolClass[];
  /** Classes déjà écoutées par l'écran parent ; sinon la fiche les écoute elle-même. */
  structuredClasses?: SchoolClassRecord[];
  structuredClassesLoaded?: boolean;
  loadError?: string;
  onClose: () => void;
  /** Appelé une fois l'élève enregistré, avec la fiche enregistrée et le message de réussite. */
  onSaved: (student: Student, message: string) => void;
}) {
  const emptyCurrentStudent = () => {
    const className = classChoices[0] ?? CLASSES[0];
    return { ...emptyStudent(school.id, year.id), className, section: getClassSection(className) };
  };
  const [form, setForm] = useState<Student>(() => target.mode === "edit"
    ? { ...target.student, option: target.student.option ? canonicalSchoolOption(target.student.option) : undefined }
    : emptyCurrentStudent());
  const [quickParent, setQuickParent] = useState<QuickParentForm>(() => emptyQuickParent(target.mode === "create" ? nextParentEmail(school, data.users, data.parents) : ""));
  const [quickParentFeedback, setQuickParentFeedback] = useState("");
  const [pendingQuickParent, setPendingQuickParent] = useState<PendingQuickParent>();
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saveInProgressRef = useRef(false);
  const creationIds = useRef(new Map<string, string>());
  const [ownClasses, setOwnClasses] = useState<SchoolClassRecord[]>([]);
  const [ownClassesLoaded, setOwnClassesLoaded] = useState(false);
  const listensItself = providedClasses === undefined;
  const structuredClasses = providedClasses ?? ownClasses;
  const structuredClassesLoaded = listensItself ? ownClassesLoaded : Boolean(providedClassesLoaded);
  const classesRef = useRef({ loaded: structuredClassesLoaded, classes: structuredClasses });
  classesRef.current = { loaded: structuredClassesLoaded, classes: structuredClasses };
  // Les choix viennent exclusivement du référentiel persistant de l'école.
  const schoolOptions = normalizeSchoolOptions(school.schoolOptions);
  const optionChoices = schoolOptions;

  useEffect(() => {
    if (!listensItself) return;
    setOwnClassesLoaded(false);
    return subscribeToSchoolClasses(school.id, year.id, (items) => { setOwnClasses(items); setOwnClassesLoaded(true); }, (cause) => { setOwnClassesLoaded(false); setSaveError(userFacingError(cause, "Chargement impossible. Veuillez réessayer.")); });
  }, [listensItself, school.id, year.id]);
  useEffect(() => {
    if (!saveError) return;
    const timer = window.setTimeout(() => setSaveError(""), 4000);
    return () => window.clearTimeout(timer);
  }, [saveError]);
  useEffect(() => {
    if (!quickParentFeedback) return;
    const timer = window.setTimeout(() => setQuickParentFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [quickParentFeedback]);

  async function saveStudent() {
    if (saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    setIsSaving(true);
    setSaveError("");
    let attemptedCreation: { id: string; schoolYearId: string; withParent: boolean } | undefined;
    let uploadedPhotoPath = "";
    let attemptedPhotoTarget: { studentId: string; schoolId: string; schoolYearId: string } | undefined;
    try {
      const exists = !form.id.startsWith("new-");
      if ((exists && !capabilities.canEdit) || (!exists && !capabilities.canCreate)) {
        setSaveError("Votre compte n'est pas autorisé à enregistrer cette fiche élève.");
        return;
      }
      const validationError = validateStudentForSave(form, school.id, year.id);
      if (validationError) {
        setSaveError(validationError);
        return;
      }
      // Un clic sur « Sauver » pendant le chargement des classes attend la fin du chargement (15 s au plus) au lieu d'échouer.
      if (!(await waitForCondition(() => classesRef.current.loaded))) { setSaveError("Chargement des classes impossible pour le moment. Veuillez réessayer."); return; }
      const structuredClasses = classesRef.current.classes;
      const previousStudent = exists ? studentRecords.find((item) => item.id === form.id) : undefined;
      const academicChanged = !previousStudent || previousStudent.classId !== form.classId
        || previousStudent.className !== form.className || previousStudent.option !== form.option
        || previousStudent.subClassId !== form.subClassId || previousStudent.classOptionKey !== form.classOptionKey;
      const academicError = academicChanged ? validateStudentAcademicSelection(structuredClasses, form, optionChoices) : "";
      if (academicError) { setSaveError(academicError); return; }
      const selectedClass = resolveStudentParentClass(structuredClasses, form);
      const selectedOptionKey = studentSchoolClassOptionKey(structuredClasses, form);
      const selectedParentId = form.parentId?.trim() ?? "";
      const pendingParentForStudent = pendingQuickParent?.parentId === selectedParentId ? pendingQuickParent : undefined;
      const matchingParents = data.parents.filter((parent) => parent.id === selectedParentId && parent.schoolId === school.id);
      if (selectedParentId && matchingParents.length === 0 && !pendingParentForStudent) {
        setSaveError("Veuillez lier cet élève à un parent avant d'enregistrer.");
        return;
      }
      if (matchingParents.length > 1) {
        setSaveError("Un élève ne peut être lié qu'à un seul parent.");
        return;
      }
      const targetYearId = exists ? form.schoolYearId : year.id;
      const student = studentForPersistence({
        ...form,
        prenom: form.prenom?.trim() ?? "",
        address: form.address?.trim() ?? "",
        id: exists ? form.id : (() => {
          // Keep the same ID on an uncertain network outcome; never silently create a second pupil.
          let id = creationIds.current.get(form.id);
          if (!id) { id = uid("student"); creationIds.current.set(form.id, id); }
          return id;
        })(),
        option: form.option ? canonicalSchoolOption(form.option) : undefined,
        matricule: exists ? form.matricule : "",
        section: getClassSection(form.className),
        status: form.status ?? "ACTIVE",
        schoolId: school.id,
        schoolYearId: targetYearId,
        annee_scolaire_id: targetYearId,
      });
      if (selectedOptionKey) student.classOptionKey = selectedOptionKey;
      else delete student.classOptionKey;
      if (selectedClass) student.classId = selectedClass.id;
      if (student.section !== "Secondaire" || !student.option) delete student.option;
      if (!student.classId) delete student.classId;
      if (!student.subClassId) delete student.subClassId;
      // Lot 9 : une nouvelle photo part dans Storage ; l'ancienne photo intégrée
      // n'est jamais effacée ici (effacement prévu plus tard, avec accord).
      const previousPhoto = previousStudent?.photoUrl ?? "";
      if (needsStorageUpload(student, previousPhoto) && student.photoUrl) {
        uploadedPhotoPath = await uploadStudentPhoto({ schoolId: school.id, studentId: student.id, dataUrl: student.photoUrl });
        student.photoPath = uploadedPhotoPath;
        attemptedPhotoTarget = { studentId: student.id, schoolId: school.id, schoolYearId: targetYearId };
        if (previousPhoto) student.photoUrl = previousPhoto; else delete student.photoUrl;
      }
      if (!student.photoPath) delete student.photoPath;
      const previousParentId = studentRecords.find((item) => item.id === student.id)?.parentId;
      if (!exists) attemptedCreation = { id: student.id, schoolYearId: targetYearId, withParent: Boolean(selectedParentId) };
      const persistedStudent = await saveManualStudent(studentForPersistence(studentBeforeParentMutation(student, previousParentId)), exists ? "update" : "create");
      const nextStudents = exists ? studentRecords.map((item) => (item.id === student.id ? persistedStudent : item)) : [...studentRecords, persistedStudent];

      if (pendingParentForStudent) {
        try {
          const provisioned = await provisionParent({
            schoolId: school.id,
            schoolYearId: targetYearId,
            parentId: pendingParentForStudent.parentId,
            name: pendingParentForStudent.fullName,
            email: pendingParentForStudent.email,
            password: pendingParentForStudent.password,
            phone: pendingParentForStudent.phone,
            address: "",
            studentIds: [student.id],
            status: "active",
          });
          const linkedStudent = { ...student, parentId: provisioned.parent.id };
          updateData({
            students: [...nextStudents.filter((item) => item.id !== linkedStudent.id), linkedStudent],
            parents: [...data.parents.filter((item) => item.id !== provisioned.parent.id), provisioned.parent],
            users: [...data.users.filter((item) => item.id !== provisioned.user.id), provisioned.user],
          }, { persist: false });
          setPendingQuickParent(undefined);
          setForm(emptyCurrentStudent());
          setQuickParent(emptyQuickParent());
          setQuickParentFeedback("");
          onSaved(linkedStudent, "Élève et compte parent enregistrés avec succès.");
          return;
        } catch (error) {
          updateData({
            students: nextStudents,
          }, { persist: false });
          setForm(persistedStudent);
          setSaveError(error instanceof Error
            ? `L’élève a été enregistré, mais le compte Parent n’a pas pu être créé : ${userFacingError(error, "erreur inconnue")}`
            : "L’élève a été enregistré, mais le compte Parent n’a pas pu être créé. Vous pouvez reprendre la liaison depuis sa fiche.");
          return;
        }
      }

      if (selectedParentId) {
        try {
          const result = await linkParentToStudent({
            schoolId: school.id,
            schoolYearId: targetYearId,
            studentId: student.id,
            parentId: selectedParentId,
            confirmation: PARENT_LINK_CONFIRMATION,
          });
          const linked = applyParentLinkResult({ students: nextStudents, parents: data.parents, users: data.users }, result);
          updateData(linked, { persist: false });
        } catch (error) {
          updateData({ students: nextStudents }, { persist: false });
          setForm(persistedStudent);
          setSaveError(error instanceof Error
            ? `L’élève a été enregistré, mais la liaison au parent n’a pas pu être confirmée : ${userFacingError(error, "erreur inconnue")}`
            : "L’élève a été enregistré, mais la liaison au parent n’a pas pu être confirmée.");
          return;
        }
      } else if (previousParentId) {
        try {
          const result = await unlinkParentFromStudent({
            schoolId: school.id,
            schoolYearId: targetYearId,
            studentId: student.id,
            parentId: previousParentId,
            confirmation: PARENT_UNLINK_CONFIRMATION,
          });
          const unlinked = applyParentUnlinkResult({ students: nextStudents, parents: data.parents, users: data.users }, result);
          updateData(unlinked, { persist: false });
        } catch (error) {
          updateData({ students: nextStudents }, { persist: false });
          setForm(persistedStudent);
          setSaveError(error instanceof Error
            ? `Les modifications de l’élève ont été enregistrées, mais la déliaison du parent a échoué : ${userFacingError(error, "erreur inconnue")}`
            : "Les modifications de l’élève ont été enregistrées, mais la déliaison du parent a échoué.");
          return;
        }
      } else {
        updateData({ students: nextStudents }, { persist: false });
      }
      setForm(emptyCurrentStudent());
      setPendingQuickParent(undefined);
      setQuickParent({ fullName: "", phone: "", email: "", password: "" });
      onSaved(persistedStudent, exists ? "Élève modifié avec succès." : "Élève enregistré avec succès.");
    } catch (error) {
      if (import.meta.env.DEV) console.error("Enregistrement de l'élève impossible.", error);
      const serverMessage = publicServerMessage(error);
      const kind = failureKind(error);
      // La photo envoyée n'est retirée qu'après confirmation qu'aucune fiche ne l'utilise.
      if (uploadedPhotoPath && attemptedPhotoTarget) void discardUploadedPhotoIfUnused({ path: uploadedPhotoPath, ...attemptedPhotoTarget });
      if (serverMessage.includes("Un élève avec le même nom, post-nom et prénom existe déjà.")) {
        setSaveError(serverMessage);
      } else if (kind === "network" && attemptedCreation) {
        // La réponse s'est perdue : vérifier la fiche avant d'annoncer un échec.
        const saved = await findSavedStudent(attemptedCreation.id, school.id, attemptedCreation.schoolYearId);
        if (saved) {
          updateData({ students: [...studentRecords.filter((item) => item.id !== saved.id), saved] }, { persist: false });
          setForm(emptyCurrentStudent());
          onSaved(saved, attemptedCreation.withParent
            ? "La connexion a été interrompue, mais l'élève a bien été enregistré. La liaison au parent reste à faire depuis sa fiche."
            : "La connexion a été interrompue, mais l'élève a bien été enregistré.");
        } else {
          setSaveError(saved === null
            ? "L'élève n'a pas été enregistré : la connexion a été interrompue. Réessayez quand la connexion revient ; aucun doublon ne sera créé."
            : "Connexion interrompue : impossible de vérifier si l'élève a été enregistré. Vérifiez la liste avant de réessayer ; aucun doublon ne sera créé.");
        }
      } else if (kind === "network" || kind === "rate-limit" || kind === "inactive-year" || kind === "unavailable") {
        setSaveError(`Impossible d'enregistrer l'élève : ${plainFailureMessage(kind, false)}`);
      } else {
        setSaveError(serverMessage ? `Impossible d'enregistrer l'élève : ${serverMessage}` : "Impossible d'enregistrer l'élève. Vérifiez les informations saisies.");
      }
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  }

  async function createParentForStudent() {
    if (!capabilities.canCreateParent) return;
    setSaveError("");
    setQuickParentFeedback("");
    if (!quickParent.fullName || !quickParent.phone || !quickParent.email) return;
    const parentId = uid("parent");
    const resolvedEmail = parentEmailExists(quickParent.email, data.users, data.parents) ? nextParentEmail(school, data.users, data.parents) : quickParent.email.trim();
    if (!quickParent.password) {
      setSaveError("Mot de passe requis pour créer le compte de connexion du parent.");
      return;
    }

    const existingStudent = studentRecords.find((student) => student.id === form.id);
    if (!existingStudent) {
      const pendingParent = { parentId, fullName: quickParent.fullName.trim(), phone: quickParent.phone.trim(), email: resolvedEmail, password: quickParent.password };
      setPendingQuickParent(pendingParent);
      setForm({ ...form, parentId });
      setQuickParent(emptyQuickParent(nextParentEmail(school, data.users, data.parents)));
      setQuickParentFeedback("Parent prêt et sélectionné. Il sera créé lors de l’enregistrement de l’élève.");
      return;
    }

    try {
      const provisioned = await provisionParent({
        schoolId: school.id,
        schoolYearId: year.id,
        parentId,
        name: quickParent.fullName,
        email: resolvedEmail,
        password: quickParent.password,
        phone: quickParent.phone,
        address: "",
        studentIds: [existingStudent.id],
        status: "active",
      });
      updateData({
        students: studentRecords.map((student) => student.id === existingStudent.id ? { ...student, parentId: provisioned.parent.id } : student),
        parents: [...data.parents, provisioned.parent],
        users: [...data.users, provisioned.user],
      }, { persist: false });
      setForm({ ...form, parentId: provisioned.parent.id });
      setQuickParent(emptyQuickParent(nextParentEmail(school, [...data.users, provisioned.user], [...data.parents, provisioned.parent])));
      setQuickParentFeedback("Parent créé et sélectionné avec succès.");
    } catch (error) {
      setSaveError(error instanceof Error ? `Création du compte de connexion du parent impossible : ${userFacingError(error, "erreur inconnue")}` : "Création du compte de connexion du parent impossible.");
    }
  }

  async function addSchoolOption(option: string) {
    if (!capabilities.canManageOptions) return false;
    const trimmed = option.trim();
    if (!trimmed) return false;
    try {
      const persisted = await persistSchoolOption(school.id, trimmed);
      updateData({ schools: data.schools.map((item) => (item.id === school.id ? { ...item, schoolOptions: persisted.schoolOptions } : item)) }, { persist: false });
      const selectedClass = structuredClasses.find((item) => !item.parentClassId && (item.id === form.classId || item.name === form.className));
      setForm({ ...form, option: persisted.option, classOptionKey: selectedClass ? schoolClassOptionKey(selectedClass.id, persisted.option) : undefined, subClassId: undefined });
      return true;
    } catch (error) {
      setSaveError(userFacingError(error, "Impossible d'enregistrer cette option scolaire."));
      return false;
    }
  }

  return (
    <AdminDrawer title={form.id.startsWith("new") ? "Ajouter un élève" : "Modifier l'élève"} onClose={() => { setQuickParentFeedback(""); onClose(); }} closeLabel="Fermer le formulaire élève">
      <StudentForm
        form={form}
        setForm={setForm}
        parents={parents}
        pendingParent={pendingQuickParent ? { id: pendingQuickParent.parentId, fullName: pendingQuickParent.fullName, phone: pendingQuickParent.phone } : undefined}
        quickParent={quickParent}
        quickParentFeedback={quickParentFeedback}
        setQuickParent={setQuickParent}
        classChoices={classChoices}
        optionChoices={optionChoices}
        optionLabels={school.schoolOptionDisplayNames}
        onAddOption={addSchoolOption}
        onCreateParent={createParentForStudent}
        onSave={saveStudent}
        onReset={() => { setForm(emptyStudent(school.id, year.id)); setPendingQuickParent(undefined); setQuickParentFeedback(""); }}
        errorMessage={saveError || loadError}
        isSaving={isSaving}
        canCreateParent={capabilities.canCreateParent}
        canAddOption={capabilities.canManageOptions}
        structuredClasses={structuredClasses}
        onAddSubclasses={(parent, labels, classOptionKey, confirmation) => createSchoolSubclasses({ schoolId: school.id, schoolYearId: year.id, parentId: parent.id, parentName: parent.name, labels, classOptionKey, confirmation }).then(() => undefined)}
        onDeleteSubclass={(subclass, confirmation) => requestSchoolSubclassDeletion({ schoolId: school.id, schoolYearId: year.id, subclassId: subclass.id, confirmation }).then(() => undefined)}
      />
    </AdminDrawer>
  );
}
