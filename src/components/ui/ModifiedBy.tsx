import { useEffect, useState } from "react";
import { cachedStaffLabel, loadStaffLabels } from "../../services/staffLabels";

// Lot R1 : « Modifié par [nom, fonction], le [date] » sous un réglage.
// Soit le nom est déjà connu (name), soit il est demandé au serveur à partir du compte (userId + schoolId).
const formatWhen = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return ` le ${date.toLocaleDateString("fr-FR")} à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
};

export function ModifiedBy({ name, functionLabel, userId, schoolId, at, verb = "Modifié" }: { name?: string; functionLabel?: string; userId?: string; schoolId?: string; at?: string; verb?: string }) {
  const [label, setLabel] = useState(() => name ? { name, functionLabel: functionLabel ?? "" } : userId && schoolId ? cachedStaffLabel(schoolId, userId) : undefined);
  useEffect(() => {
    if (name) { setLabel({ name, functionLabel: functionLabel ?? "" }); return undefined; }
    if (!userId || !schoolId) return undefined;
    const cached = cachedStaffLabel(schoolId, userId);
    if (cached) { setLabel(cached); return undefined; }
    let active = true;
    loadStaffLabels(schoolId, [userId]).then((labels) => { if (active) setLabel(labels[userId]); }).catch(() => undefined);
    return () => { active = false; };
  }, [name, functionLabel, userId, schoolId]);
  if (!label) return null;
  return <p className="text-xs text-slate-500" data-modified-by="true">{verb} par {label.name}{label.functionLabel ? `, ${label.functionLabel}` : ""}{formatWhen(at)}</p>;
}
