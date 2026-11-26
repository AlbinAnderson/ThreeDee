import { useMemo } from 'react';
import { canControlCombatant, canControlToken, combatantName, combatActions, isCombatantHidden, newId, type Combatant } from '@vtt/shared';
import { initiativeForToken } from '../characters/characterActions';
import { NumberField } from '../components/fields';
import { dispatch } from '../state/dispatch';
import { getSelf, useGameStore } from '../state/gameStore';
import { useGame, useIsGm, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { useUi } from '../state/uiStore';

/** Add the selected tokens (that you control) to the turn order. */
export function addSelectedToCombat() {
  const state = useGameStore.getState().view;
  const self = getSelf();
  if (!state || !self) return;
  const ids = useUi.getState().selectedTokenIds;
  let added = 0;
  for (const id of ids) {
    const token = state.tokens[id];
    if (!token || !canControlToken(self, token)) continue;
    if (state.combat.combatants.some((c) => c.tokenId === id)) continue;
    // A token linked to a character brings its initiative modifier along.
    const linked = initiativeForToken(token.id);
    const ok = dispatch(
      combatActions.add.create({
        combatant: {
          id: newId(),
          name: token.name || linked?.name || 'Token',
          tokenId: token.id,
          initiative: null,
          modifier: linked?.modifier ?? 0,
          // Follows the token's own hidden flag; this is only the GM's extra override.
          hidden: false,
        },
      }),
    );
    if (ok) added++;
  }
  if (!added) notify(ids.length ? 'Those tokens are already in the turn order' : 'Select tokens on the map first', 'info');
}

export function CombatPanel() {
  const combat = useGame((s) => s.combat);
  const state = useGame((s) => s);
  const self = useSelf();
  const gm = useIsGm();

  const visible = useMemo(() => combat.combatants.filter((c) => gm || !isCombatantHidden(state, c)), [combat.combatants, gm, state]);
  const current = combat.combatants.find((c) => c.id === combat.currentId);
  const myTurn = !!current && combat.active && canControlCombatant(state, self, current);
  const unrolled = combat.combatants.filter((c) => c.initiative === null && canControlCombatant(state, self, c));

  function addCustom() {
    const name = prompt('Name (e.g. "Lair action" or "Goblin 3"):')?.trim();
    if (!name) return;
    dispatch(
      combatActions.add.create({
        combatant: { id: newId(), name: name.slice(0, 60), tokenId: null, initiative: null, modifier: 0, hidden: false },
      }),
    );
  }

  return (
    <div className="panel-scroll">
      <section>
        <div className="section-header">
          <h3>{combat.active ? `Round ${combat.round}` : 'Turn order'}</h3>
          {gm && (
            <div className="button-row compact">
              {combat.active ? (
                <>
                  <button type="button" className="small" onClick={() => dispatch(combatActions.prev.create({}))} title="Previous turn">
                    ◀
                  </button>
                  <button type="button" className="small" onClick={() => dispatch(combatActions.end.create({ clear: false }))}>
                    End
                  </button>
                </>
              ) : (
                <button type="button" className="small primary" onClick={() => dispatch(combatActions.start.create({}))}>
                  Start combat
                </button>
              )}
            </div>
          )}
        </div>

        {(myTurn || (gm && combat.active)) && (
          <button type="button" className="primary wide" onClick={() => dispatch(combatActions.next.create({}))}>
            {myTurn && !gm ? 'End my turn' : 'Next turn ▶'}
          </button>
        )}

        {visible.length === 0 && <p className="muted">Nobody in the turn order. Select tokens on the map and add them.</p>}
        <ol className="combat-list">
          {visible.map((c, i) => (
            <CombatRow
              key={c.id}
              combatant={c}
              name={combatantName(state, c)}
              hidden={isCombatantHidden(state, c)}
              tokenHidden={isCombatantHidden(state, c) && !c.hidden}
              isCurrent={combat.active && c.id === combat.currentId}
              canEdit={canControlCombatant(state, self, c)}
              gm={gm}
              prevId={visible[i - 1]?.id ?? null}
              nextNextId={visible[i + 2]?.id ?? null}
              isLast={i === visible.length - 1}
            />
          ))}
        </ol>
      </section>
      <section className="button-row">
        <button type="button" onClick={addSelectedToCombat}>
          + Add selected tokens
        </button>
        {gm && (
          <button type="button" onClick={addCustom}>
            + Custom entry
          </button>
        )}
        {unrolled.length > 0 && (
          <button type="button" onClick={() => dispatch(combatActions.rollInitiative.create({ ids: unrolled.map((c) => c.id) }))}>
            Roll initiative ({unrolled.length})
          </button>
        )}
        {gm && !combat.active && combat.combatants.length > 0 && (
          <button type="button" className="danger" onClick={() => confirm('Clear the turn order?') && dispatch(combatActions.end.create({ clear: true }))}>
            Clear
          </button>
        )}
      </section>
      <p className="muted small-text">
        Initiative is 1d20 + modifier, highest first, ties broken by modifier. Use ↑/↓ to delay or ready. During combat the order
        isn't re-sorted automatically.
      </p>
    </div>
  );
}

function CombatRow({
  combatant: c,
  name,
  hidden,
  tokenHidden,
  isCurrent,
  canEdit,
  gm,
  prevId,
  nextNextId,
  isLast,
}: {
  combatant: Combatant;
  name: string;
  hidden: boolean;
  /** Hidden because its token is hidden (not via the tracker's own toggle). */
  tokenHidden: boolean;
  isCurrent: boolean;
  canEdit: boolean;
  gm: boolean;
  prevId: string | null;
  nextNextId: string | null;
  isLast: boolean;
}) {
  const update = (changes: Parameters<typeof combatActions.update.create>[0]['changes']) =>
    dispatch(combatActions.update.create({ id: c.id, changes }));
  return (
    <li className={`combat-row${isCurrent ? ' current' : ''}${hidden ? ' hidden-entry' : ''}`}>
      <div className="combat-main">
        <span className="combat-name" title={name}>
          {isCurrent && '▶ '}
          {name}
        </span>
        {hidden && <span className="badge subtle" title={tokenHidden ? 'Its token is hidden' : undefined}>hidden</span>}
      </div>
      <div className="combat-fields">
        {canEdit ? (
          <>
            <NumberField label="Init" value={c.initiative ?? 0} min={-1000} max={1000} onCommit={(initiative) => update({ initiative })} />
            <NumberField label="Mod" value={c.modifier} min={-100} max={100} step={1} onCommit={(modifier) => update({ modifier: Math.round(modifier) })} />
          </>
        ) : (
          <span className="combat-init">{c.initiative ?? '–'}</span>
        )}
      </div>
      {canEdit && (
        <div className="combat-actions">
          <button type="button" className="icon-button" title="Roll initiative" onClick={() => dispatch(combatActions.rollInitiative.create({ ids: [c.id] }))}>
            🎲
          </button>
          <button
            type="button"
            className="icon-button"
            title="Move up"
            disabled={!prevId}
            onClick={() => prevId && dispatch(combatActions.move.create({ id: c.id, beforeId: prevId }))}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button"
            title="Move down (delay)"
            disabled={isLast}
            onClick={() => dispatch(combatActions.move.create({ id: c.id, beforeId: nextNextId }))}
          >
            ↓
          </button>
          {gm && (
            <button
              type="button"
              className="icon-button"
              disabled={tokenHidden}
              title={tokenHidden ? 'Hidden because its token is hidden' : c.hidden ? 'Reveal to players' : 'Hide from players'}
              onClick={() => update({ hidden: !c.hidden })}
            >
              {hidden ? '👁' : '◌'}
            </button>
          )}
          <button type="button" className="icon-button" title="Remove" onClick={() => dispatch(combatActions.remove.create({ id: c.id }))}>
            ×
          </button>
        </div>
      )}
    </li>
  );
}
