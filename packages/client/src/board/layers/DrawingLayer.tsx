import { memo, useMemo } from 'react';
import type { Drawing } from '@vtt/shared';
import { useGame } from '../../state/hooks';
import { useUi } from '../../state/uiStore';
import { useInteraction } from '../interactionStore';
import type { LayerProps } from './types';

export function DrawingLayer({ scene }: LayerProps) {
  const drawings = useGame((s) => s.drawings);
  const preview = useInteraction((s) => s.drawPreview);
  const zoom = useUi((s) => s.camera.zoom);
  const erasing = useUi((s) => s.toolId === 'erase');

  const visible = useMemo(() => Object.values(drawings).filter((d) => d.sceneId === scene.id), [drawings, scene.id]);
  // Thin lines are hard to hit; give the eraser a generous invisible target.
  const hitWidth = 14 / zoom;

  return (
    <g className={`layer-drawings${erasing ? ' erasing' : ''}`}>
      {visible.map((d) => (
        <DrawingView key={d.id} drawing={d} hitWidth={hitWidth} />
      ))}
      {preview && preview.sceneId === scene.id && <DrawingView drawing={preview} hitWidth={0} />}
    </g>
  );
}

function shapeElement(d: Drawing, props: React.SVGProps<SVGElement>) {
  const p = d.points;
  switch (d.shape) {
    case 'freehand': {
      let path = `M ${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) path += ` L ${p[i]} ${p[i + 1]}`;
      // A single click draws a dot.
      if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) path += ' l 0.01 0';
      return <path d={path} {...(props as React.SVGProps<SVGPathElement>)} />;
    }
    case 'line':
      return <line x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} {...(props as React.SVGProps<SVGLineElement>)} />;
    case 'rect': {
      const [x0, y0, x1, y1] = p as [number, number, number, number];
      return (
        <rect
          x={Math.min(x0, x1)}
          y={Math.min(y0, y1)}
          width={Math.abs(x1 - x0)}
          height={Math.abs(y1 - y0)}
          {...(props as React.SVGProps<SVGRectElement>)}
        />
      );
    }
    case 'ellipse': {
      const [x0, y0, x1, y1] = p as [number, number, number, number];
      return (
        <ellipse
          cx={(x0 + x1) / 2}
          cy={(y0 + y1) / 2}
          rx={Math.abs(x1 - x0) / 2}
          ry={Math.abs(y1 - y0) / 2}
          {...(props as React.SVGProps<SVGEllipseElement>)}
        />
      );
    }
  }
}

const DrawingView = memo(function DrawingView({ drawing, hitWidth }: { drawing: Drawing; hitWidth: number }) {
  return (
    <g data-drawing-id={drawing.id} className="drawing">
      {shapeElement(drawing, {
        stroke: drawing.color,
        strokeWidth: drawing.width,
        fill: drawing.fill ? drawing.color : 'none',
        fillOpacity: drawing.fill ? 0.25 : undefined,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        pointerEvents: 'none',
      })}
      {hitWidth > 0 &&
        shapeElement(drawing, {
          stroke: 'transparent',
          strokeWidth: Math.max(hitWidth, drawing.width),
          fill: drawing.fill ? 'transparent' : 'none',
          className: 'drawing-hit',
        })}
    </g>
  );
});
