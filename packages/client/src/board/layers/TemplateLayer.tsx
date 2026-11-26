import { memo, useMemo } from 'react';
import { templateCells, type GridSettings, type Template } from '@vtt/shared';
import { useGame } from '../../state/hooks';
import { useUi } from '../../state/uiStore';
import { useTemplateTool } from '../../tools/templateTool';
import type { LayerProps } from './types';

export function TemplateLayer({ scene }: LayerProps) {
  const templates = useGame((s) => s.templates);
  const preview = useTemplateTool((s) => s.preview);
  const zoom = useUi((s) => s.camera.zoom);
  const erasing = useUi((s) => s.toolId === 'erase');
  const list = useMemo(() => Object.values(templates).filter((t) => t.sceneId === scene.id), [templates, scene.id]);

  return (
    <g className={`layer-templates${erasing ? ' erasing' : ''}`}>
      {list.map((t) => (
        <TemplateView key={t.id} template={t} grid={scene.grid} zoom={zoom} />
      ))}
      {preview && preview.sceneId === scene.id && <TemplateView template={preview} grid={scene.grid} zoom={zoom} isPreview />}
    </g>
  );
}

function outline(t: Template, cell: number) {
  const size = t.size * cell;
  switch (t.kind) {
    case 'circle':
      return <circle cx={t.x} cy={t.y} r={size} />;
    case 'square':
      return <rect x={t.x - size} y={t.y - size} width={size * 2} height={size * 2} />;
    case 'cone': {
      const half = (t.coneAngle * Math.PI) / 360;
      const a1 = t.angle - half;
      const a2 = t.angle + half;
      const large = t.coneAngle > 180 ? 1 : 0;
      return (
        <path
          d={`M ${t.x} ${t.y} L ${t.x + size * Math.cos(a1)} ${t.y + size * Math.sin(a1)} A ${size} ${size} 0 ${large} 1 ${t.x + size * Math.cos(a2)} ${t.y + size * Math.sin(a2)} Z`}
        />
      );
    }
    case 'line': {
      const w = (t.width * cell) / 2;
      const ux = Math.cos(t.angle);
      const uy = Math.sin(t.angle);
      const px = -uy * w;
      const py = ux * w;
      const ex = t.x + ux * size;
      const ey = t.y + uy * size;
      return <polygon points={`${t.x + px},${t.y + py} ${ex + px},${ey + py} ${ex - px},${ey - py} ${t.x - px},${t.y - py}`} />;
    }
  }
}

const TemplateView = memo(function TemplateView({
  template: t,
  grid,
  zoom,
  isPreview,
}: {
  template: Template;
  grid: GridSettings;
  zoom: number;
  isPreview?: boolean;
}) {
  const cells = useMemo(() => templateCells(t, grid), [t, grid]);
  const label = grid.unitsPerCell ? `${t.size * grid.unitsPerCell} ${grid.unitLabel}` : `${t.size} sq`;
  const k = 1 / zoom;
  return (
    <g data-template-id={isPreview ? undefined : t.id} className="template">
      {cells.map((c) => (
        <rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={grid.size} height={grid.size} fill={t.color} fillOpacity={0.28} pointerEvents="none" />
      ))}
      <g className="template-outline" stroke={t.color} strokeWidth={2.5 * k} fill={t.color} fillOpacity={cells.length ? 0.04 : 0.2}>
        {outline(t, grid.size)}
      </g>
      {isPreview && (
        <g transform={`translate(${t.x} ${t.y}) scale(${k})`} pointerEvents="none">
          <rect x={10} y={-30} width={label.length * 9 + 16} height={24} rx={6} className="ruler-label-bg" />
          <text x={18} y={-13} className="ruler-label">
            {label}
          </text>
        </g>
      )}
    </g>
  );
});
