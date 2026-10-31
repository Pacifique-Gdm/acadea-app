import { useEffect, useState } from 'react';
import { manageSectionAdministrator, type SectionAdministratorSummary } from '../../services/provisioning';
const confirmations = { activate: 'ACTIVER CET UTILISATEUR', deactivate: 'DÉSACTIVER CET UTILISATEUR', delete: 'SUPPRIMER CET UTILISATEUR' };
const labels: Record<string, string> = { kindergarten_admin: 'Directrice Maternelle', primary_admin: 'Admin. Primaire', studies_prefect: "Préfet d’études" };
export function SectionAdministratorActions({ schoolId }: { schoolId: string }) {
  const [users, setUsers] = useState<SectionAdministratorSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ id: string; operation: keyof typeof confirmations }>();
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => {
    let cancelled = false;
    void manageSectionAdministrator({ schoolId, operation: 'list' }).then(result => { if (!cancelled) setUsers(result.users ?? []); }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [schoolId]);
  async function confirm() {
    if (!pending || busy || confirmation !== confirmations[pending.operation]) return;
    setBusy(true); setError('');
    try {
      await manageSectionAdministrator({ schoolId, userId: pending.id, operation: pending.operation, confirmation });
      setPending(undefined); setConfirmation('');
      const result = await manageSectionAdministrator({ schoolId, operation: 'list' });
      setUsers(result.users ?? []);
    } catch (error) { setError(error instanceof Error ? error.message : 'Opération impossible.'); }
    finally { setBusy(false); }
  }
  return <section className="grid gap-3 sm:col-span-2"><h3 className="font-bold">Administrateurs par section</h3><p className="text-sm">Les activations restent bloquées pendant la validation des protections.</p>
    {error && <p role="alert">{error}</p>}
    {users.map(user => <article key={user.id} className="grid gap-2 rounded border p-3"><p>{user.name} — {labels[user.role]} — {user.sectionIds?.join(', ')} — {user.status}</p><div className="flex flex-wrap gap-2">{(['activate', 'deactivate', 'delete'] as const).map(operation => <button key={operation} type="button" className="secondary-button" disabled={busy} onClick={() => { setPending({ id: user.id, operation }); setConfirmation(''); setError(''); }}>{operation === 'activate' ? 'Activer' : operation === 'deactivate' ? 'Désactiver' : 'Supprimer'}</button>)}</div></article>)}
    {pending && <div role="alertdialog" aria-label="Confirmer l’action sur le profil" className="grid gap-2"><label>Saisissez exactement {confirmations[pending.operation]}<input className="input" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label><button type="button" disabled={busy || confirmation !== confirmations[pending.operation]} onClick={() => void confirm()}>Confirmer</button><button type="button" disabled={busy} onClick={() => setPending(undefined)}>Annuler</button></div>}
  </section>;
}
