import { create } from 'zustand';
import { cellCenter, lightActions, newId } from '@vtt/shared';
import { defineTool } from './types';

interface LightToolState {
  bright: number;
  dim: number;
  color: string;
  set(changes: Partial<Omit<LightToolState, 'set'>>): void;
}

export const useLightTool = create<LightToolState>()((set) => ({
  bright: 4,
  dim: 8,
  color: '#ffd27a',
  set: (changes) => set(changes),
}));

/**
 * GM: click to place a light (snapped to a cell center; Shift = free).
 * Alt-click a light to remove it. Lights matter in scenes marked dark.
 */
export const lightTool = defineTool<null>({
  id: 'light',
  label: 'Lights',
  icon: '☀',
  hotkey: 'l',
  gmOnly: true,
  cursor: 'crosshair',
  Options: LightOptions,
  createState: () => null,

  onPointerDown(p, ctx) {
    if (p.alt) {
      const tolerance = 16 / ctx.camera.zoom;
      const hit = Object.values(ctx.game.lights).find(
        (l) => l.sceneId === ctx.scene.id && Math.hypot(l.x - p.world.x, l.y - p.world.y) < tolerance,
      );
      if (hit) ctx.dispatch(lightActions.remove.create({ id: hit.id }));
      return;
    }
    const pos = p.shift ? p.world : cellCenter(p.world, ctx.scene.grid);
    const { bright, dim, color } = useLightTool.getState();
    ctx.dispatch(
      lightActions.add.create({
        light: { id: newId(), sceneId: ctx.scene.id, x: Math.round(pos.x), y: Math.round(pos.y), bright, dim: Math.max(dim, bright), color },
      }),
    );
  },
});

function LightOptions() {
  const s = useLightTool();
  return (
    <div className="tool-options">
      <label className="inline-control" title="Bright light radius (cells)">
        Bright
        <input type="number" min={0} max={200} value={s.bright} onChange={(e) => s.set({ bright: Math.max(0, Number(e.target.value) || 0) })} />
      </label>
      <label className="inline-control" title="Dim light radius (cells)">
        Dim
        <input type="number" min={0} max={400} value={s.dim} onChange={(e) => s.set({ dim: Math.max(0, Number(e.target.value) || 0) })} />
      </label>
      <input type="color" value={s.color} onChange={(e) => s.set({ color: e.target.value })} title="Light color" />
      <span className="muted small-text">Click to place · Alt-click a light to remove · Radii in cells</span>
    </div>
  );
}
