import { useEffect, useState } from "react";
import { collection, onSnapshot, type Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { Coordination } from "../types";

export function subscribeToRealtimeCoordinations(
  database: Firestore | null,
  onData: (coordinations: Coordination[]) => void,
  onError: (message: string) => void,
) {
  if (!database) return undefined;
  return onSnapshot(
    collection(database, "coordinations"),
    (snapshot) => {
      onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Coordination)).sort((a, b) => a.name.localeCompare(b.name, "fr")));
      onError("");
    },
    () => onError("Impossible de charger les Coordinations."),
  );
}

export function useRealtimeCoordinations() {
  const [coordinations, setCoordinations] = useState<Coordination[]>([]);
  const [error, setError] = useState("");
  useEffect(() => subscribeToRealtimeCoordinations(db as Firestore | null, setCoordinations, setError), []);
  return { coordinations, error };
}
