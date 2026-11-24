// Lot E du caissier : plusieurs préparations de répartition dans UNE transaction Firestore.
// Firestore exige « toutes les lectures, puis toutes les écritures ». Chaque préparation lit, puis écrit
// dans ce tampon ; la suivante relit le tampon (cumul juste des soldes, des ancres et des totaux).
// À la fin, le tampon est écrit une seule fois dans la vraie transaction. Rien n'est écrit en cas de refus.

const isDocRef = (ref) => typeof ref?.path === "string" && ref.path.split("/").length % 2 === 0;

export function createTransactionOverlay(transaction) {
  const base = new Map(); // chemin → { exists, data } lu dans la vraie transaction
  const buffer = new Map(); // chemin → { ref, exists, data, blind? } ; blind : écrit sans avoir été lu
  let flushed = false;
  const snapshot = (path, exists, data) => ({ id: path.split("/").at(-1), exists, data: () => (exists ? structuredClone(data) : undefined) });
  async function read(ref) {
    if (!base.has(ref.path)) {
      const real = await transaction.get(ref);
      if (!base.has(ref.path)) base.set(ref.path, { exists: real.exists, data: real.exists ? real.data() : undefined });
    }
    return base.get(ref.path);
  }
  const guard = () => { if (flushed) throw new Error("Tampon de transaction déjà écrit."); };
  const known = (path) => buffer.get(path) ?? base.get(path);
  const blindOp = (path, op, data, merge = false) => {
    // Écriture sur un document jamais lu : on ne peut pas le relire ensuite (la répartition ne le fait pas).
    const prior = buffer.get(path)?.blind;
    if (prior && prior.op !== op) throw new Error("Écritures incompatibles sur un document non lu.");
    return { op, merge: merge || prior?.merge === true, data: prior ? { ...prior.data, ...data } : data };
  };
  const overlay = {
    async get(ref) {
      if (!isDocRef(ref)) return transaction.get(ref); // requêtes : lues telles quelles
      if (buffer.get(ref.path)?.blind) throw new Error("Lecture d'un document écrit sans lecture préalable.");
      const value = buffer.get(ref.path) ?? await read(ref);
      return snapshot(ref.path, value.exists, value.data);
    },
    create(ref, data) {
      guard();
      const value = known(ref.path);
      if (!value) { buffer.set(ref.path, { ref, exists: true, blind: blindOp(ref.path, "create", structuredClone(data)) }); return; }
      if (value.exists) throw new Error("Document déjà présent.");
      buffer.set(ref.path, { ref, exists: true, data: structuredClone(data) });
    },
    set(ref, data, options) {
      guard();
      const value = known(ref.path);
      if (!value || value.blind) { buffer.set(ref.path, { ref, exists: true, blind: blindOp(ref.path, "set", structuredClone(data), options?.merge === true) }); return; }
      buffer.set(ref.path, { ref, exists: true, data: options?.merge && value.exists ? { ...value.data, ...structuredClone(data) } : structuredClone(data) });
    },
    update(ref, data) {
      guard();
      const value = known(ref.path);
      if (!value || value.blind) { buffer.set(ref.path, { ref, exists: true, blind: blindOp(ref.path, "update", structuredClone(data)) }); return; }
      if (!value.exists) throw new Error("Document absent.");
      buffer.set(ref.path, { ref, exists: true, data: { ...value.data, ...structuredClone(data) } });
    },
    delete(ref) { guard(); buffer.set(ref.path, { ref, exists: false }); },
  };
  return {
    transaction: overlay,
    /** État de départ (lu) et état final (tampon) des documents lus puis écrits dont le chemin commence par `prefix`. */
    changes(prefix) {
      return [...buffer].filter(([path, value]) => path.startsWith(prefix) && !value.blind)
        .map(([path, value]) => ({ path, before: base.get(path)?.exists ? base.get(path).data : null, after: value.exists ? value.data : null }));
    },
    /** Documents connus (lus ou écrits après lecture) dont le chemin commence par `prefix`. */
    known(prefix) {
      return [...new Set([...base.keys(), ...buffer.keys()])].filter((path) => path.startsWith(prefix))
        .map((path) => known(path)).filter((value) => value?.exists && !value.blind).map((value) => value.data);
    },
    /** Écrit le tampon dans la vraie transaction (après toutes les lectures). */
    flush() {
      guard();
      flushed = true;
      for (const [path, value] of buffer) {
        if (value.blind) {
          if (value.blind.op === "create") transaction.create(value.ref, value.blind.data);
          else if (value.blind.op === "update") transaction.update(value.ref, value.blind.data);
          else transaction.set(value.ref, value.blind.data, ...(value.blind.merge ? [{ merge: true }] : []));
          continue;
        }
        if (!value.exists) { if (base.get(path)?.exists) transaction.delete(value.ref); continue; }
        if (base.get(path)?.exists) transaction.set(value.ref, value.data);
        else transaction.create(value.ref, value.data);
      }
    },
  };
}
