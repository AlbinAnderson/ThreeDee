/**
 * Short-lived board state written by tools and read by overlay layers
 * (drag previews, rulers, pings). Never synced as game state.
 */
import { create } from 'zustand';
import { newId, type Point } from '@vtt/shared';

export interface Ping {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  color: string;
}

interface InteractionState {
  /** Token id -> preview top-left while dragging. */
  dragPreview: Record<string, Point>;
  ruler: { sceneId: string; from: Point; to: Point } | null;
  pings: Ping[];

  setDragPreview(preview: Record<string, Point>): void;
  setRuler(ruler: InteractionState['ruler']): void;
  addPing(ping: Omit<Ping, 'id'>): void;
}

export const PING_DURATION_MS = 2000;

export const useInteraction = create<InteractionState>()((set) => ({
  dragPreview: {},
  ruler: null,
  pings: [],

  setDragPreview: (dragPreview) => set({ dragPreview }),
  setRuler: (ruler) => set({ ruler }),
  addPing(ping) {
    const id = newId();
    set((s) => ({ pings: [...s.pings, { ...ping, id }] }));
    setTimeout(() => set((s) => ({ pings: s.pings.filter((p) => p.id !== id) })), PING_DURATION_MS);
  },
}));
