import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_database: unknown, name: string) => name),
  onSnapshot: vi.fn(),
}));

vi.mock("../firebase", () => ({ db: { kind: "firestore" } }));
vi.mock("@firebase/firestore", () => ({ collection: mocks.collection, onSnapshot: mocks.onSnapshot }));

import { subscribeToRealtimeCoordinations } from "./useRealtimeCoordinations";

describe("Coordinations en temps réel du Super Administrateur", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.onSnapshot.mockReturnValue(vi.fn()); });

  it("écoute une seule fois la collection réelle, trie et nettoie le listener", () => {
    const onData = vi.fn();
    const onError = vi.fn();
    const unsubscribe = vi.fn();
    mocks.onSnapshot.mockReturnValue(unsubscribe);
    const stop = subscribeToRealtimeCoordinations({} as never, onData, onError);
    expect(mocks.collection).toHaveBeenCalledWith({}, "coordinations");
    expect(mocks.onSnapshot).toHaveBeenCalledOnce();
    const callback = mocks.onSnapshot.mock.calls[0][1] as (snapshot: { docs: Array<{ id: string; data: () => unknown }> }) => void;
    callback({ docs: [
      { id: "b", data: () => ({ name: "Zulu", status: "active" }) },
      { id: "a", data: () => ({ name: "Alpha", status: "inactive" }) },
    ] });
    expect(onData.mock.calls[0][0].map((item: { id: string }) => item.id)).toEqual(["a", "b"]);
    expect(onError).toHaveBeenLastCalledWith("");
    stop?.();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("retourne un état d'erreur sûr et refuse une base absente", () => {
    const onError = vi.fn();
    expect(subscribeToRealtimeCoordinations(null, vi.fn(), onError)).toBeUndefined();
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
    subscribeToRealtimeCoordinations({} as never, vi.fn(), onError);
    const errorCallback = mocks.onSnapshot.mock.calls[0][2] as () => void;
    errorCallback();
    expect(onError).toHaveBeenCalledWith("Impossible de charger les Coordinations.");
  });
});
