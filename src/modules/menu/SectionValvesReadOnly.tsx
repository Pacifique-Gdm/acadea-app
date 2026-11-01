import { useEffect, useRef, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../../firebase";
import type { AppUser } from "../../types";
import { loadSectionSchoolRecords, type SectionValve } from "../../services/sectionSchoolRecords";
import { AttachmentsList, type ValveAttachmentListItem } from "../../components/valves/AttachmentsList";

function Publication({ publication }: { publication: SectionValve }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Component lifetime bounds file responses after a scope change.
  async function download(item: ValveAttachmentListItem) {
    if (!app || !item.path || busy) return;
    setBusy(true); setError("");
    try {
      const call = httpsCallable<{ valveId: string; path: string }, { name: string; contentType: string; dataBase64: string }>(getFunctions(app, "europe-west1"), "messageAttachmentFile");
      const { data } = await call({ valveId: publication.id, path: item.path });
      if (!mounted.current) return;
      const bytes = Uint8Array.from(atob(data.dataBase64), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: data.contentType }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = data.name; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { if (mounted.current) setError("Téléchargement refusé ou indisponible. Veuillez réessayer."); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <article className="grid min-w-0 gap-2 rounded border border-slate-200 p-3 text-sm">
    <strong>{publication.title}</strong><span>{publication.section} · {publication.authorName}</span>
    <p className="whitespace-pre-wrap break-words">{publication.body}</p>
    <AttachmentsList attachments={publication.attachments} onView={(item) => void download(item)} />
    {busy && <p role="status">Téléchargement sécurisé…</p>}{error && <p role="alert">{error}</p>}
  </article>;
}

export function SectionValvesReadOnly({ user, schoolId, schoolYearId }: { user: AppUser; schoolId: string; schoolYearId: string }) {
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([user.id, user.role, user.status, user.active, user.sectionIds, schoolId, schoolYearId, refresh]);
  const [state, setState] = useState<{ key: string; items?: SectionValve[]; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void loadSectionSchoolRecords("valves", user, schoolId, schoolYearId, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setState({ key, items }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, error: "Consultation indisponible. Veuillez réessayer." }); });
    return () => controller.abort();
  }, [key, schoolId, schoolYearId, user]);
  const current = state?.key === key ? state : undefined;
  return <div className="grid min-w-0 gap-3">
    <p className="text-sm text-slate-600">Publications explicitement attribuées à vos sections — lecture seule. Les archives sans section vérifiable ne sont pas exposées.</p>
    <button type="button" className="secondary-button" onClick={() => setRefresh((value) => value + 1)}>Actualiser</button>
    {!current && <p role="status">Chargement…</p>}{current?.error && <p role="alert">{current.error}</p>}
    {current?.items?.length === 0 && <p>Aucune publication dans vos sections.</p>}
    {current?.items?.map((publication) => <Publication key={`${key}:${publication.id}`} publication={publication} />)}
  </div>;
}
