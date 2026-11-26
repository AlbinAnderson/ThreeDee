/**
 * Short-lived board state written by tools and read by overlay layers
 * (drag previews, rulers, pings). Never synced as game state.
 */
import { create } from 'zustand';
import { newId, type Drawing, type Point } from '@vtt/shared';

export interface Ping {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  color: string;
}

export interface RemoteRuler {
  sceneId: string;
  from: Point;
  to: Point;
  color: string;
  at: number;
}

interface InteractionState {
  /** Token id -> preview top-left while dragging. */
  dragPreview: Record<string, Point>;
  ruler: { sceneId: string; from: Point; to: Point } | null;
  pings: Ping[];
  /** Drawing in progress (not yet committed). */
  drawPreview: Drawing | null;
  /** Other users' live rulers, by user id. */
  remoteRulers: Record<string, RemoteRuler>;

  setDragPreview(preview: Record<string, Point>): void;
  setRuler(ruler: InteractionState['ruler']): void;
  addPing(ping: Omit<Ping, 'id'>): void;
  setDrawPreview(drawing: Drawing | null): void;
  setRemoteRuler(userId: string, ruler: RemoteRuler | null): void;
}

export const PING_DURATION_MS = 2000;

export const useInteraction = create<InteractionState>()((set) => ({
  dragPreview: {},
  ruler: null,
  pings: [],
  drawPreview: null,
  remoteRulers: {},

  setDragPreview: (dragPreview) => set({ dragPreview }),
  setRuler: (ruler) => set({ ruler }),
  setDrawPreview: (drawPreview) => set({ drawPreview }),
  setRemoteRuler: (userId, ruler) =>
    set((s) => {
      const remoteRulers = { ...s.remoteRulers };
      if (ruler) remoteRulers[userId] = ruler;
      else delete remoteRulers[userId];
      return { remoteRulers };
    }),
  addPing(ping) {
    const id = newId();
    set((s) => ({ pings: [...s.pings, { ...ping, id }] }));
    setTimeout(() => set((s) => ({ pings: s.pings.filter((p) => p.id !== id) })), PING_DURATION_MS);
  },
}));

// Drop rulers from people who disconnected mid-measure.
setInterval(() => {
  const { remoteRulers, setRemoteRuler } = useInteraction.getState();
  for (const [userId, r] of Object.entries(remoteRulers)) if (Date.now() - r.at > 5000) setRemoteRuler(userId, null);
}, 2000);
