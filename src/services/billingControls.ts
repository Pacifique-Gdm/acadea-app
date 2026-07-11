import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, firebaseReady } from "../firebase";

export type BillingControls = {
  valvesUploadsEnabled: boolean;
  reason?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export const defaultBillingControls: BillingControls = {
  valvesUploadsEnabled: true,
};

const billingControlsRef = () => {
  if (!firebaseReady || !db) return null;
  return doc(db, "platformSettings", "billingControls");
};

export async function loadBillingControls(): Promise<BillingControls> {
  const documentRef = billingControlsRef();
  if (!documentRef) return defaultBillingControls;

  const snapshot = await getDoc(documentRef);
  if (!snapshot.exists()) return defaultBillingControls;

  const data = snapshot.data() as Partial<BillingControls>;
  return {
    ...defaultBillingControls,
    ...data,
    valvesUploadsEnabled: data.valvesUploadsEnabled !== false,
  };
}

export async function saveValvesUploadsEnabled(enabled: boolean, updatedBy?: string): Promise<BillingControls> {
  const documentRef = billingControlsRef();
  if (!documentRef) {
    throw new Error("Firestore indisponible.");
  }

  const nextControls: BillingControls = {
    valvesUploadsEnabled: enabled,
    ...(enabled ? {} : { reason: "storage_cost_control" }),
    updatedAt: new Date().toISOString(),
    ...(updatedBy ? { updatedBy } : {}),
  };

  await setDoc(documentRef, nextControls);
  return nextControls;
}
