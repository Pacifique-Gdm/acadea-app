import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "@firebase/firestore";
import type { Firestore, Query } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, Message } from "../types";

type UseRealtimeMessageFeedOptions = {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  enabled: boolean;
};

function mergeMessages(items: Message[]) {
  const itemsById = new Map<string, Message>();
  items.forEach((item) => {
    itemsById.set(item.id, item);
  });
  return Array.from(itemsById.values()).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function messageFeedQueries(database: Firestore, user: AppUser, schoolId: string, schoolYearId: string): Query[] {
  const constraints = [
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
  ];
  const recentConstraints = [orderBy("createdAt", "desc"), limit(30)];
  const messagesCollection = collection(database, "messages");

  if (user.role === "parent") {
    if (!user.parentId) return [];
    return [
      query(
        messagesCollection,
        ...constraints,
        where("threadParentId", "==", user.parentId),
        ...recentConstraints,
      ),
    ];
  }

  if (user.role === "discipline_director") {
    return [
      query(
        messagesCollection,
        ...constraints,
        where("schoolRecipient", "==", "discipline"),
        ...recentConstraints,
      ),
    ];
  }

  const recipients = user.role === "cashier" ? ["cashier", "both"] : ["admin", "both"];
  return [
    query(
      messagesCollection,
      ...constraints,
      where("schoolRecipient", "in", recipients),
      ...recentConstraints,
    ),
  ];
}

export function useRealtimeMessageFeed({ user, schoolId, schoolYearId, enabled }: UseRealtimeMessageFeedOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setMessages([]);
    setError("");
  }, [schoolId, schoolYearId, user.id, user.role, user.parentId]);

  useEffect(() => {
    if (!enabled || !firebaseReady || !db || !schoolId || !schoolYearId) return undefined;
    const database = db as unknown as Firestore;
    const queries = messageFeedQueries(database, user, schoolId, schoolYearId);
    const snapshots = new Array<Message[]>(queries.length).fill([]);
    const unsubscribes = queries.map((messageQuery, index) =>
      onSnapshot(
        messageQuery,
        (snapshot) => {
          snapshots[index] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Message);
          setMessages(mergeMessages(snapshots.flat()));
          setError("");
        },
        (listenerError) => {
          console.warn("Ecoute des messages recents impossible.", listenerError);
          setError("Impossible d'actualiser les messages en temps réel.");
        },
      ),
    );
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled, schoolId, schoolYearId, user]);

  return { messages, error };
}
