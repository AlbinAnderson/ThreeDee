/**
 * Local-only UI state (never synced): current tool, selection, camera, etc.
 */
import { create } from 'zustand';
import type { ChatWhisper, DrawingShape } from '@vtt/shared';

export interface Camera {
  /** Screen-space offset of the scene origin. */
  x: number;
  y: number;
  zoom: number;
}

export interface DrawSettings {
  shape: DrawingShape;
  color: string;
  width: number;
  fill: boolean;
}

/** Who sees what you post in chat (rolls from anywhere in the UI use this too). */
export interface ChatMode {
  mode: 'public' | 'gm' | 'whisper';
  to: string[];
}

interface UiState {
  toolId: string;
  selectedTokenIds: string[];
  /** GM-only: scene being viewed/edited locally. null = follow the active scene. */
  viewedSceneId: string | null;
  camera: Camera;
  viewport: { width: number; height: number };
  sidebarPanel: string;
  draw: DrawSettings;
  chatMode: ChatMode;
  /** Local volume multiplier for the jukebox (0..1). */
  masterVolume: number;

  setTool(id: string): void;
  setSelection(ids: string[]): void;
  clearSelection(): void;
  setViewedScene(id: string | null): void;
  setCamera(camera: Camera): void;
  setViewport(size: { width: number; height: number }): void;
  setSidebarPanel(id: string): void;
  setDraw(changes: Partial<DrawSettings>): void;
  setChatMode(mode: ChatMode): void;
  setMasterVolume(v: number): void;
  resetForRoom(): void;
}

function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem('vtt.volume'));
    return Number.isFinite(v) && localStorage.getItem('vtt.volume') !== null ? Math.max(0, Math.min(1, v)) : 0.7;
  } catch {
    return 0.7;
  }
}

export const useUi = create<UiState>()((set) => ({
  toolId: 'select',
  selectedTokenIds: [],
  viewedSceneId: null,
  camera: { x: 0, y: 0, zoom: 1 },
  viewport: { width: 0, height: 0 },
  sidebarPanel: 'chat',
  draw: { shape: 'freehand', color: '#ff4d4d', width: 4, fill: false },
  chatMode: { mode: 'public', to: [] },
  masterVolume: loadVolume(),

  setTool: (toolId) => set({ toolId }),
  setSelection: (selectedTokenIds) => set({ selectedTokenIds }),
  clearSelection: () => set({ selectedTokenIds: [] }),
  setViewedScene: (viewedSceneId) => set({ viewedSceneId, selectedTokenIds: [] }),
  setCamera: (camera) => set({ camera }),
  setViewport: (viewport) => set({ viewport }),
  setSidebarPanel: (sidebarPanel) => set({ sidebarPanel }),
  setDraw: (changes) => set((s) => ({ draw: { ...s.draw, ...changes } })),
  setChatMode: (chatMode) => set({ chatMode }),
  setMasterVolume: (masterVolume) => {
    set({ masterVolume });
    try {
      localStorage.setItem('vtt.volume', String(masterVolume));
    } catch {
      /* ignore */
    }
  },
  resetForRoom: () => set({ selectedTokenIds: [], viewedSceneId: null, toolId: 'select' }),
}));

/** The `whisper` field for a message posted with the current chat mode. */
export function currentWhisper(): ChatWhisper | undefined {
  const { mode, to } = useUi.getState().chatMode;
  if (mode === 'public') return undefined;
  return { mode, to: mode === 'whisper' ? to : [] };
}

export function screenToWorld(camera: Camera, sx: number, sy: number) {
  return { x: (sx - camera.x) / camera.zoom, y: (sy - camera.y) / camera.zoom };
}

/** World coordinates of the middle of the visible board. */
export function viewportCenterWorld() {
  const { camera, viewport } = useUi.getState();
  return screenToWorld(camera, viewport.width / 2, viewport.height / 2);
}
