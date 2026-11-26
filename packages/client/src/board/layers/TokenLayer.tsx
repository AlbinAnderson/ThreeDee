import { memo, useMemo } from 'react';
import type { Point, Token } from '@vtt/shared';
import { conditionStyle, hpColor } from '../../config/conditions';
import { useGame, useIsGm, useSelf } from '../../state/hooks';
import { useUi } from '../../state/uiStore';
import { useInteraction } from '../interactionStore';
import type { LayerProps } from './types';

export function TokenLayer({ scene }: LayerProps) {
  const tokens = useGame((s) => s.tokens);
  const gm = useIsGm();
  const self = useSelf();
  const selected = useUi((s) => s.selectedTokenIds);
  const preview = useInteraction((s) => s.dragPreview);
  const currentTokenId = useGame((s) =>
    s.combat.active ? (s.combat.combatants.find((c) => c.id === s.combat.currentId)?.tokenId ?? null) : null,
  );

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
          isTurn={t.id === currentTokenId}
          showHp={!!t.hp && (gm || t.hpVisible || t.ownerIds.includes(self.id))}
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
  isTurn: boolean;
  showHp: boolean;
}

const TokenView = memo(function TokenView({ token, cellSize, selected, preview, isTurn, showHp }: TokenViewProps) {
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
      {isTurn && <circle className="token-turn" cx={r} cy={r} r={r + 7} />}
      {selected && <circle className="token-selection" cx={r} cy={r} r={r + 3} />}
      {token.conditions.length > 0 && <ConditionMarkers conditions={token.conditions} px={px} />}
      {showHp && token.hp && <HpBar hp={token.hp} px={px} />}
      {token.showName && token.name && (
        <text className="token-name" x={r} y={px + 4 + (showHp ? Math.max(5, px * 0.09) + 2 : 0)}>
          {token.name}
        </text>
      )}
    </g>
  );
});

function HpBar({ hp, px }: { hp: NonNullable<Token['hp']>; px: number }) {
  const h = Math.max(5, px * 0.09);
  const w = px * 0.9;
  const max = Math.max(1, hp.max);
  const f = Math.max(0, Math.min(1, hp.value / max));
  const tf = Math.min(1 - f, hp.temp / max);
  return (
    <g transform={`translate(${px * 0.05} ${px + 2})`} pointerEvents="none">
      <title>{`${hp.value} / ${hp.max}${hp.temp ? ` (+${hp.temp} temp)` : ''}`}</title>
      <rect width={w} height={h} rx={h / 2} fill="rgba(0,0,0,0.7)" />
      <rect width={w * f} height={h} rx={h / 2} fill={hpColor(hp.value, hp.max)} />
      {tf > 0 && <rect x={w * f} width={w * tf} height={h} rx={h / 2} fill="#4dabf7" />}
    </g>
  );
}

function ConditionMarkers({ conditions, px }: { conditions: string[]; px: number }) {
  const r = Math.max(6, px * 0.13);
  const shown = conditions.slice(0, 4);
  const extra = conditions.length - shown.length;
  return (
    <g pointerEvents="none">
      {shown.map((c, i) => {
        const style = conditionStyle(c);
        // Stack down the right edge of the token.
        return (
          <g key={c} transform={`translate(${px - r * 0.6} ${r * 0.6 + i * r * 1.9})`}>
            <title>{c}</title>
            <circle r={r} fill={style.color} stroke="#000" strokeWidth={1} />
            <text className="condition-glyph" fontSize={r * 1.2}>
              {style.icon}
            </text>
          </g>
        );
      })}
      {extra > 0 && (
        <text x={px - r * 0.6} y={r * 0.6 + shown.length * r * 1.9} className="condition-glyph" fontSize={r}>
          +{extra}
        </text>
      )}
    </g>
  );
}
