import { memo, useMemo } from 'react';
import type { Point, Token } from '@vtt/shared';
import { useGame, useIsGm } from '../../state/hooks';
import { useUi } from '../../state/uiStore';
import { useInteraction } from '../interactionStore';
import type { LayerProps } from './types';

export function TokenLayer({ scene }: LayerProps) {
  const tokens = useGame((s) => s.tokens);
  const gm = useIsGm();
  const selected = useUi((s) => s.selectedTokenIds);
  const preview = useInteraction((s) => s.dragPreview);

  const visible = useMemo(
    () =>
      Object.values(tokens)
        .filter((t) => t.sceneId === scene.id && (gm || !t.hidden))
        // larger tokens underneath smaller ones
        .sort((a, b) => b.size - a.size),
    [tokens, scene.id, gm],
  );

  return (
    <g className="layer-tokens">
      {visible.map((t) => (
        <TokenView
          key={t.id}
          token={t}
          cellSize={scene.grid.size}
          selected={selected.includes(t.id)}
          preview={preview[t.id]}
        />
      ))}
    </g>
  );
}

interface TokenViewProps {
  token: Token;
  cellSize: number;
  selected: boolean;
  preview: Point | undefined;
}

const TokenView = memo(function TokenView({ token, cellSize, selected, preview }: TokenViewProps) {
  const px = token.size * cellSize;
  const r = px / 2;
  const { x, y } = preview ?? token;
  const clipId = `token-clip-${token.id}`;
  const initials = token.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  return (
    <g
      data-token-id={token.id}
      className={`token${selected ? ' selected' : ''}${preview ? ' dragging' : ''}`}
      transform={`translate(${x} ${y})`}
      opacity={token.hidden ? 0.5 : 1}
    >
      <circle cx={r} cy={r} r={r - 1} fill={token.color} />
      {token.imageUrl ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <circle cx={r} cy={r} r={r - 3} />
            </clipPath>
          </defs>
          <image
            href={token.imageUrl}
            width={px}
            height={px}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
        </>
      ) : (
        <text className="token-initials" x={r} y={r} fontSize={r * 0.8}>
          {initials}
        </text>
      )}
      <circle cx={r} cy={r} r={r - 1.5} fill="none" stroke={token.color} strokeWidth={3} />
      {selected && <circle className="token-selection" cx={r} cy={r} r={r + 3} />}
      {token.showName && token.name && (
        <text className="token-name" x={r} y={px + 4}>
          {token.name}
        </text>
      )}
    </g>
  );
});
