import { useMemo } from 'react';
import type { Token } from '@vtt/shared';
import { conditionStyle, hpColor } from '../config/conditions';
import { useCurrentSceneId, useGame, useSelf } from '../state/hooks';
import { useUi } from '../state/uiStore';
import { focusToken } from '../lib/tokens';
import { canSeeTokenHp } from '../lib/tokenVisibility';

function useSceneTokens(filter: (t: Token) => boolean) {
  const sceneId = useCurrentSceneId();
  const tokens = useGame((s) => s.tokens);
  return useMemo(
    () => Object.values(tokens).filter((t) => t.sceneId === sceneId && filter(t)).sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokens, sceneId],
  );
}

/** Player-controlled tokens on the current scene. */
export function PartySection() {
  const list = useSceneTokens((t) => t.ownerIds.length > 0);
  return <TokenStatusList tokens={list} empty="No player tokens on this scene." />;
}

/** GM-only: everything else on the scene with HP or conditions. */
export function OthersSection() {
  const list = useSceneTokens((t) => t.ownerIds.length === 0 && (!!t.hp || t.conditions.length > 0));
  return <TokenStatusList tokens={list} empty="No other tokens with HP or conditions." />;
}

function TokenStatusList({ tokens, empty }: { tokens: Token[]; empty: string }) {
  const self = useSelf();
  const users = useGame((s) => s.users);
  const selected = useUi((s) => s.selectedTokenIds);
  if (!tokens.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="status-list">
      {tokens.map((t) => {
        const hpShown = canSeeTokenHp(self, t);
        const owners = t.ownerIds.map((id) => users[id]?.name).filter(Boolean).join(', ');
        return (
          <li key={t.id} className={selected.includes(t.id) ? 'selected' : ''}>
            <button type="button" onClick={() => focusToken(t.id)}>
              <span className="status-row">
                <span className="swatch" style={{ background: t.color }} />
                <span className="status-name">{t.name || '(unnamed)'}</span>
                {owners && <span className="muted small-text">{owners}</span>}
                {hpShown && t.hp && (
                  <span className="status-hp">
                    {t.hp.value}/{t.hp.max}
                    {t.hp.temp ? <span className="temp-hp"> +{t.hp.temp}</span> : null}
                  </span>
                )}
              </span>
              {hpShown && t.hp && (
                <span className="hp-bar-html">
                  <span
                    style={{
                      display: 'block',
                      width: `${Math.max(0, Math.min(100, (t.hp.value / Math.max(1, t.hp.max)) * 100))}%`,
                      background: hpColor(t.hp.value, t.hp.max),
                    }}
                  />
                </span>
              )}
              {t.conditions.length > 0 && (
                <span className="condition-chips">
                  {t.conditions.map((c) => (
                    <span key={c} className="condition-chip on" style={{ background: conditionStyle(c).color }}>
                      <span className="condition-icon">{conditionStyle(c).icon}</span>
                      {c}
                      {t.conditionRounds[c] ? <span className="condition-rounds"> ⏱{t.conditionRounds[c]}</span> : null}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
