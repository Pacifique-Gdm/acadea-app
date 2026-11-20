import { useCallback, useEffect, useState } from "react";
import { defaultBillingControls, loadBillingControls, saveValvesUploadsEnabled } from "../services/billingControls";
import type { BillingControls } from "../services/billingControls";
import { userFacingError } from "../utils/userFacingError";

export type UseBillingControlsResult = {
  controls: BillingControls;
  loading: boolean;
  error: string;
  setValvesUploadsEnabled: (enabled: boolean, updatedBy?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export function useBillingControls(enabled = true): UseBillingControlsResult {
  const [controls, setControls] = useState<BillingControls>(defaultBillingControls);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextControls = await loadBillingControls();
      setControls(nextControls);
    } catch (refreshError) {
      setError(userFacingError(refreshError, "Chargement du contrôle des pièces jointes impossible."));
      setControls(defaultBillingControls);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setControls(defaultBillingControls);
      setLoading(false);
      setError("");
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const setValvesUploadsEnabled = useCallback(async (enabled: boolean, updatedBy?: string) => {
    setLoading(true);
    setError("");
    try {
      const nextControls = await saveValvesUploadsEnabled(enabled, updatedBy);
      setControls(nextControls);
    } catch (saveError) {
      setError(userFacingError(saveError, "Enregistrement du contrôle des pièces jointes impossible."));
      throw saveError;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    controls,
    loading,
    error,
    setValvesUploadsEnabled,
    refresh,
  };
}
