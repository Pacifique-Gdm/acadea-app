import { useRef, useState, type ReactNode } from "react";
import { AdminDrawer, PasswordField } from "../../components/ui";
import type { AppUser, Coordination } from "../../types";
import { createCoordinator, setCoordinatorStatus, updateCoordinationAsSuperAdmin, updateCoordinator } from "../../services/coordinationService";

export function CoordinationAdminActions({ coordination, coordinators, children, onClose }: { coordination: Coordination; coordinators: AppUser[]; children: ReactNode; onClose: () => void }) {
  const [panel, setPanel] = useState<"edit" | "coordinators" | "add-coordinator" | null>(null);
  const [values, setValues] = useState({ name: "", code: "", phone: "", email: "", address: "" });
  const [editor, setEditor] = useState<"new" | AppUser | null>(null);
  const [identity, setIdentity] = useState({ name: "", phone: "", email: "", password: "" });
  const [removeTarget, setRemoveTarget] = useState<AppUser | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const users = coordinators.filter((user) => user.coordinationId === coordination.id && !user.removedAt);
  async function run(action: () => Promise<unknown>, success: string) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); setMessage(success); setEditor(null); setIdentity({ name: "", email: "", phone: "", password: "" }); setRemoveTarget(null); setConfirmation(""); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Opération impossible."); return false; }
    finally { inFlight.current = false; setBusy(false); }
  }
  function editUser(user: "new" | AppUser) {
    setEditor(user); setError(""); setMessage(""); setRemoveTarget(null);
    setIdentity(user === "new" ? { name: "", email: "", phone: "", password: "" } : { name: user.name, email: user.email, phone: user.phone ?? "", password: "" });
  }
  function closePanel() {
    if (busy) return;
    setPanel(panel === "add-coordinator" ? "coordinators" : null); setEditor(null); setIdentity({ name: "", email: "", phone: "", password: "" }); setRemoveTarget(null); setConfirmation(""); setError("");
  }
  return <AdminDrawer key={panel ?? "details"} title={panel === "edit" ? "Modifier la Coordination" : panel === "coordinators" ? "Coordinateurs" : panel === "add-coordinator" ? "Ajouter coordinateur" : coordination.name} closeLabel={panel === "add-coordinator" ? "Retour aux Coordinateurs" : panel ? "Retour aux informations de la Coordination" : "Fermer la fiche Coordination"} onClose={panel ? closePanel : onClose}>
    <section className="grid min-w-0 gap-3" aria-label="Gestion de la Coordination">
    {!panel && <>
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <button type="button" disabled={busy} className="secondary-button min-w-0 justify-center" onClick={() => { setPanel("edit"); setError(""); setMessage(""); setValues({ name: coordination.name, code: coordination.code ?? "", phone: coordination.phone ?? "", email: coordination.email ?? "", address: coordination.address ?? "" }); }}>Modifier</button>
      <button type="button" disabled={busy} className="secondary-button min-w-0 justify-center" onClick={() => { setPanel("coordinators"); setError(""); setMessage(""); }}>Coordinateurs</button>
    </div>
    {children}
    </>}
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    {panel === "edit" && <form className="grid min-w-0 gap-3" onSubmit={(event) => { event.preventDefault(); void run(() => updateCoordinationAsSuperAdmin(coordination.id, values), "Coordination modifiée.").then((saved) => { if (saved) setPanel(null); }); }}>
      {([ ["name", "Nom"], ["code", "Code / sigle"], ["phone", "Téléphone"], ["email", "E-mail institutionnel"], ["address", "Adresse"] ] as const).map(([key, label]) => <label key={key} className="grid min-w-0 gap-1 text-sm">{label}<input className="input min-w-0" disabled={busy} required={key === "name"} type={key === "email" ? "email" : "text"} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })}/></label>)}
      <button type="submit" disabled={busy} className="primary-button justify-center">{busy ? "Enregistrement…" : "Enregistrer la Coordination"}</button>
    </form>}
    {panel === "coordinators" && <div className="grid min-w-0 gap-3">
      <button type="button" disabled={busy || coordination.status !== "active"} className="primary-button w-full min-w-0 justify-center" onClick={() => { editUser("new"); setPanel("add-coordinator"); }}>Ajouter coordinateur</button>
      {users.length === 0 && <p>Aucun Coordinateur.</p>}
      {users.map((user) => <article key={user.id} className="grid min-w-0 gap-2 rounded border p-3" aria-label={`Coordinateur ${user.name}`}><strong className="break-words">{user.name}</strong><p className="break-all text-sm">{user.email}</p><p className="text-sm">{user.phone || "—"} · {user.status === "inactive" || user.active === false ? "Suspendu" : "Actif"}</p><div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" disabled={busy} className="secondary-button min-w-0 justify-center" onClick={() => editUser(user)}>Modifier</button>
        <button type="button" disabled={busy} className="secondary-button min-w-0 justify-center" onClick={() => void run(() => setCoordinatorStatus(coordination.id, user.id, user.status === "inactive" || user.active === false ? "reactivate-coordinator" : "suspend-coordinator"), "État du Coordinateur mis à jour.")}>{user.status === "inactive" || user.active === false ? "Réactiver" : "Suspendre"}</button>
        <button type="button" disabled={busy} className="secondary-button min-w-0 justify-center text-red-700" onClick={() => { setRemoveTarget(user); setConfirmation(""); setEditor(null); }}>Supprimer</button>
      </div></article>)}
      {removeTarget && <div role="alertdialog" aria-label="Supprimer le Coordinateur" className="grid min-w-0 gap-3 rounded border border-red-200 p-3"><p>Supprimer l'accès de {removeTarget.name} ? La Coordination, ses écoles et les historiques seront conservés.</p><label className="grid gap-1 text-sm">Tapez SUPPRIMER CE COORDINATEUR<input className="input min-w-0" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy}/></label><div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setRemoveTarget(null)}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy || confirmation !== "SUPPRIMER CE COORDINATEUR"} onClick={() => void run(() => setCoordinatorStatus(coordination.id, removeTarget.id, "remove-coordinator", confirmation), "Accès du Coordinateur supprimé.")}>Confirmer la suppression</button></div></div>}
    </div>}
    {editor && (panel === "coordinators" || panel === "add-coordinator") && <form className="grid min-w-0 gap-3 rounded border p-3" aria-label={editor === "new" ? "Ajouter coordinateur" : "Modifier le Coordinateur"} onSubmit={(event) => { event.preventDefault(); const { password, ...fields } = identity; void run(() => editor === "new" ? createCoordinator(coordination.id, { ...fields, password }) : updateCoordinator(coordination.id, editor.id, fields), editor === "new" ? "Coordinateur ajouté." : "Coordinateur modifié.").then((saved) => { if (saved && editor === "new") setPanel("coordinators"); }); }}>
        {([ ["name", "Nom Coordinateur"], ["email", "E-mail Coordinateur"], ["phone", "Téléphone Coordinateur"] ] as const).map(([key, label]) => <label key={key} className="grid min-w-0 gap-1 text-sm">{label}<input className="input min-w-0" disabled={busy} required={key !== "phone"} type={key === "email" ? "email" : "text"} value={identity[key]} onChange={(event) => setIdentity({ ...identity, [key]: event.target.value })}/></label>)}
        {editor === "new" && <PasswordField label="Mot de passe temporaire" value={identity.password} onChange={(password) => setIdentity({ ...identity, password })} minLength={6} disabled={busy}/>}
        <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className="secondary-button justify-center" onClick={() => { setEditor(null); setPanel("coordinators"); setIdentity({ name: "", email: "", phone: "", password: "" }); }}>Annuler</button><button type="submit" disabled={busy} className="primary-button justify-center">Enregistrer</button></div>
      </form>}
    </section>
  </AdminDrawer>;
}
