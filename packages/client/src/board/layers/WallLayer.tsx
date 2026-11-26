import { useMemo, type PointerEvent } from 'react';
import { wallActions, type Wall } from '@vtt/shared';
import { dispatch } from '../../state/dispatch';
import { useGame, useIsGm } from '../../state/hooks';
import { useUi } from '../../state/uiStore';
import { useWallTool } from '../../tools/wallTool';
import type { LayerProps } from './types';

const DOOR_COLORS = { closed: '#ffa94d', open: '#69db7c', locked: '#ff6b6b' } as const;

/**
 * Walls are drawn for the GM only. Doors get a clickable handle for everyone:
 * click to open/close; the GM shift-clicks to lock/unlock.
 */
export function WallLayer({ scene }: LayerProps) {
  const gm = useIsGm();
  const walls = useGame((s) => s.walls);
  const zoom = useUi((s) => s.camera.zoom);
  const preview = useWallTool((s) => s.preview);
  const sceneWalls = useMemo(() => Object.values(walls).filter((w) => w.sceneId === scene.id), [walls, scene.id]);
  const k = 1 / zoom;

  return (
    <g className="layer-walls">
      {gm &&
        sceneWalls.map((w) => (
          <line
            key={w.id}
            x1={w.points[0]}
            y1={w.points[1]}
            x2={w.points[2]}
            y2={w.points[3]}
            className={`wall${w.door ? ` door ${w.door}` : ''}`}
            stroke={w.door ? DOOR_COLORS[w.door] : '#7fa7ff'}
            strokeWidth={4 * k}
            pointerEvents="none"
          />
        ))}
      {preview && preview.sceneId === scene.id && (
        <line
          x1={preview.points[0]}
          y1={preview.points[1]}
          x2={preview.points[2]}
          y2={preview.points[3]}
          stroke={preview.door ? DOOR_COLORS.closed : '#7fa7ff'}
          strokeWidth={4 * k}
          strokeDasharray={`${8 * k} ${6 * k}`}
          pointerEvents="none"
        />
      )}
      {sceneWalls.filter((w) => w.door).map((w) => (
        <DoorHandle key={w.id} wall={w} k={k} gm={gm} />
      ))}
    </g>
  );
}

function DoorHandle({ wall, k, gm }: { wall: Wall; k: number; gm: boolean }) {
  const [x1, y1, x2, y2] = wall.points;
  const state = wall.door!;
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't start a tool gesture
    let next: Wall['door'];
    if (gm && e.shiftKey) next = state === 'locked' ? 'closed' : 'locked';
    else next = state === 'open' ? 'closed' : 'open';
    if (state === 'locked' && !gm) next = 'open'; // let authorize explain it's locked
    dispatch(wallActions.setDoor.create({ id: wall.id, door: next! }));
  }
  const label = state === 'open' ? 'Open door (click to close)' : state === 'locked' ? 'Locked door' : 'Closed door (click to open)';
  return (
    <g
      transform={`translate(${(x1 + x2) / 2} ${(y1 + y2) / 2}) scale(${k})`}
      className="door-handle"
      onPointerDown={onPointerDown}
      pointerEvents="all"
    >
      <title>{gm ? `${label}. Shift-click to ${state === 'locked' ? 'unlock' : 'lock'}.` : label}</title>
      <circle r={11} fill="#16171a" stroke={DOOR_COLORS[state]} strokeWidth={2.5} />
      <text className="door-glyph" fill={DOOR_COLORS[state]}>
        {state === 'open' ? '⇆' : state === 'locked' ? '🔒' : '▮'}
      </text>
    </g>
  );
}
