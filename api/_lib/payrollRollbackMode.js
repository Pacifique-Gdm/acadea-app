// Le verrou ne concerne que les nouveaux paiements du personnel.
// Il est lu dans la transaction, après la vérification d'idempotence.
export function payrollWritesSuspended() {
  return process.env.ACADEA_PAYROLL_WRITES_SUSPENDED === "true";
}
