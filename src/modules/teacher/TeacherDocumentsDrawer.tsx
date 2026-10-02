import { useMemo, useState } from "react";
import { AdminDrawer } from "../../components/ui/AdminDrawer";
import type { AppUser, School, SchoolYear } from "../../types";
import { pedagogicalDocumentCategories, pedagogicalDocumentCategoryLabels, teacherAssignmentViews, type PedagogicalDocumentCategory } from "./teacherLearning";
import { archivePedagogicalDocument, savePedagogicalDocument } from "./teacherLearningService";
import { downloadTeacherDocument, uploadTeacherDocument } from "./teacherDocumentStorage";
import type { TeacherPortalData } from "./teacherPortalData";
import { useTeacherLearning } from "./useTeacherLearning";

export function TeacherDocumentsDrawer({ user, school, year, data, onClose }: { user: AppUser; school: School; year: SchoolYear; data: TeacherPortalData; onClose: () => void }) {
  const learning = useTeacherLearning(user, school.id, year.id, data.teacher?.id);
  const views = useMemo(() => teacherAssignmentViews(data.assignments, data.subjects, data.classes), [data.assignments, data.subjects, data.classes]);
  const [assignmentId, setAssignmentId] = useState(views[0]?.assignment.id ?? "");
  const [category, setCategory] = useState<PedagogicalDocumentCategory>("PREPARATION");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [chapter, setChapter] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const view = views.find((item) => item.assignment.id === assignmentId);
    if (!view || !data.teacher || !file || !title.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const id = crypto.randomUUID();
      const uploaded = await uploadTeacherDocument({ schoolId: school.id, schoolYearId: year.id, teacherId: data.teacher.id, assignmentId: view.assignment.id, documentId: id, file });
      const now = new Date().toISOString();
      await savePedagogicalDocument(user, { id, schoolId: school.id, schoolYearId: year.id, teacherId: data.teacher.id, assignmentId, classId: view.assignment.classId, subjectId: view.assignment.subjectId, category, title: title.trim(), description: description.trim() || undefined, chapter: chapter.trim() || undefined, storagePath: uploaded.path, originalFileName: file.name, mimeType: file.type, size: file.size, archived: false, createdAt: now, createdBy: user.id, updatedAt: now, updatedBy: user.id });
      setTitle(""); setDescription(""); setChapter(""); setFile(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ajout impossible."); }
    finally { setBusy(false); }
  }

  async function download(storagePath: string, originalFileName: string) {
    setError("");
    try { await downloadTeacherDocument({ storagePath, originalFileName }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Téléchargement impossible."); }
  }

  return <AdminDrawer title="Documents pédagogiques" closeLabel="Fermer" onClose={() => !busy && onClose()}>
    <p className="text-sm text-slate-600">Préparations et ressources</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!views.length ? <p className="rounded bg-slate-50 p-4">Aucun cours ne vous a encore été affecté.</p> : <div className="grid gap-3 rounded border border-slate-200 p-4">
      <select className="input" value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>{views.map((item) => <option key={item.assignment.id} value={item.assignment.id}>{item.subject?.name ?? "Matière"} — {item.schoolClass?.name ?? "Classe"}</option>)}</select>
      <select className="input" value={category} onChange={(event) => setCategory(event.target.value as PedagogicalDocumentCategory)}>{pedagogicalDocumentCategories.map((item) => <option key={item} value={item}>{pedagogicalDocumentCategoryLabels[item]}</option>)}</select>
      <input className="input" placeholder="Titre *" value={title} onChange={(event) => setTitle(event.target.value)} />
      <input className="input" placeholder="Chapitre ou thème" value={chapter} onChange={(event) => setChapter(event.target.value)} />
      <textarea className="input min-h-20" placeholder="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
      <input className="input" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={(event) => setFile(event.target.files?.[0])} />
      <button type="button" className="primary-button justify-center" disabled={busy || !file || !title.trim()} onClick={() => void submit()}>{busy ? "Envoi…" : "Ajouter le document"}</button>
    </div>}
    <div className="grid gap-2">{learning.documents.filter((item) => !item.archived).map((item) => <article key={item.id} className="rounded border border-slate-200 p-3">
      <strong>{item.title}</strong><p className="text-xs text-slate-500">{pedagogicalDocumentCategoryLabels[item.category]} · {item.originalFileName}</p>
      <div className="mt-2 flex gap-2"><button type="button" className="secondary-button" onClick={() => void download(item.storagePath, item.originalFileName)}>Voir / télécharger</button><button type="button" className="secondary-button" onClick={() => void archivePedagogicalDocument(user, item)}>Archiver</button></div>
    </article>)}{!learning.loading && !learning.documents.some((item) => !item.archived) && <p className="text-sm text-slate-500">Aucun document pédagogique enregistré.</p>}</div>
  </AdminDrawer>;
}
