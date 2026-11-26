import { defineTool } from './types';

/** Click to draw everyone's attention to a spot. */
export const pingTool = defineTool<null>({
  id: 'ping',
  label: 'Ping',
  icon: '◎',
  hotkey: 'p',
  cursor: 'crosshair',
  createState: () => null,

  onPointerDown(p, ctx) {
    const { x, y } = p.world;
    ctx.interaction.addPing({ sceneId: ctx.scene.id, x, y, color: ctx.self.color });
    ctx.sendEphemeral({ kind: 'ping', sceneId: ctx.scene.id, x, y });
  },
});
