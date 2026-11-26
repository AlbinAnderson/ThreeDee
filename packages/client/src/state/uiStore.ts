/**
 * Local-only UI state (never synced): current tool, selection, camera, etc.
 */
import { create } from 'zustand';

export interface Camera {
  /** Screen-space offset of the scene origin. */
  x: number;
  y: number;
  zoom: number;
}

interface UiState {
  toolId: string;
  selectedTokenIds: string[];
  /** GM-only: scene being viewed/edited locally. null = follow the active scene. */
  viewedSceneId: string | null;
  camera: Camera;
  viewport: { width: number; height: number };
  sidebarPanel: string;

  setTool(id: string): void;
  setSelection(ids: string[]): void;
  clearSelection(): void;
  setViewedScene(id: string | null): void;
  setCamera(camera: Camera): void;
  setViewport(size: { width: number; height: number }): void;
  setSidebarPanel(id: string): void;
  resetForRoom(): void;
}

export const useUi = create<UiState>()((set) => ({
  toolId: 'select',
  selectedTokenIds: [],
  viewedSceneId: null,
  camera: { x: 0, y: 0, zoom: 1 },
  viewport: { width: 0, height: 0 },
  sidebarPanel: 'chat',

  setTool: (toolId) => set({ toolId }),
  setSelection: (selectedTokenIds) => set({ selectedTokenIds }),
  clearSelection: () => set({ selectedTokenIds: [] }),
  setViewedScene: (viewedSceneId) => set({ viewedSceneId, selectedTokenIds: [] }),
  setCamera: (camera) => set({ camera }),
  setViewport: (viewport) => set({ viewport }),
  setSidebarPanel: (sidebarPanel) => set({ sidebarPanel }),
  resetForRoom: () => set({ selectedTokenIds: [], viewedSceneId: null, toolId: 'select' }),
}));

export function screenToWorld(camera: Camera, sx: number, sy: number) {
  return { x: (sx - camera.x) / camera.zoom, y: (sy - camera.y) / camera.zoom };
}

/** World coordinates of the middle of the visible board. */
export function viewportCenterWorld() {
  const { camera, viewport } = useUi.getState();
  return screenToWorld(camera, viewport.width / 2, viewport.height / 2);
}
