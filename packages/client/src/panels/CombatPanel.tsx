import { useMemo } from 'react';
import { ArrowDown, ArrowUp, BookOpen, ChevronLeft, ChevronRight, Dices, Eye, EyeOff, Play, X } from 'lucide-react';
import {
  canControlCombatant,
  canControlToken,
  combatantName,
  combatActions,
  isCombatantHidden,
  newId,
  type Character,
  type Combatant,
  type Token,
} from '@vtt/shared';
import { initiativeForToken } from '../characters/characterActions';
import { NumberField } from '../components/fields';
import { confirmDialog, promptDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { getSelf, useGameStore } from '../state/gameStore';
import { useCurrentSceneId, useGame, useIsGm, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { useUi } from '../state/uiStore';
import { canFocusToken, canSeeTokenHp, characterForToken, focusToken, openCharacterSheet } from '../lib/tokens';
import { conditionStyle, hpColor } from '../config/conditions';

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
  const tokens = useGame((s) => s.tokens);
  const characters = useGame((s) => s.characters);
  const self = useSelf();
  const gm = useIsGm();

  const visible = useMemo(() => combat.combatants.filter((c) => gm || !isCombatantHidden({ tokens }, c)), [combat.combatants, gm, tokens]);
  const current = combat.combatants.find((c) => c.id === combat.currentId);
  const myTurn = !!current && combat.active && canControlCombatant({ tokens }, self, current);
  const currentSceneId = useCurrentSceneId();
  const unrolled = combat.combatants.filter((c) => c.initiative === null && canControlCombatant({ tokens }, self, c));

  async function addCustom() {
    const name = (await promptDialog({ title: 'Add custom entry', label: 'Name', placeholder: 'e.g. Lair action or Goblin 3', confirmLabel: 'Add', maxLength: 60 }))?.trim();
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
                  <button type="button" className="small" onClick={() => dispatch(combatActions.prev.create({}))} title="Previous turn" aria-label="Previous turn">
                    <ChevronLeft size={13} />
                  </button>
                  <button type="button" className="small" onClick={() => dispatch(combatActions.end.create({ clear: false }))}>
                    End
                  </button>
                </>
              ) : (
                <button type="button" className="small gold" onClick={() => dispatch(combatActions.start.create({}))}>
                  Start combat
                </button>
              )}
            </div>
          )}
        </div>

        {(myTurn || (gm && combat.active)) && (
          <button type="button" className="gold wide" onClick={() => dispatch(combatActions.next.create({}))}>
            {myTurn && !gm ? 'End my turn' : 'Next turn'} <Play size={12} />
          </button>
        )}

        {visible.length === 0 && <p className="muted">Nobody in the turn order. Select tokens on the map and add them.</p>}
        <ol className="combat-list">
          {visible.map((c, i) => {
            const token = c.tokenId ? tokens[c.tokenId] : undefined;
            return (
            <CombatRow
              key={c.id}
              combatant={c}
              token={token}
              character={characterForToken({ characters }, token?.id)}
              hpShown={!!token && canSeeTokenHp(self, token)}
              canFocus={!!token && canFocusToken(self, token, currentSceneId)}
              name={combatantName({ tokens }, c)}
              hidden={isCombatantHidden({ tokens }, c)}
              tokenHidden={isCombatantHidden({ tokens }, c) && !c.hidden}
              isCurrent={combat.active && c.id === combat.currentId}
              canEdit={canControlCombatant({ tokens }, self, c)}
              gm={gm}
              prevId={visible[i - 1]?.id ?? null}
              nextNextId={visible[i + 2]?.id ?? null}
              isLast={i === visible.length - 1}
            />
            );
          })}
        </ol>
      </section>
      <section className="button-row">
        <button type="button" onClick={addSelectedToCombat}>
          + Add selected tokens
        </button>
        {gm && (
          <button type="button" onClick={() => void addCustom()}>
            + Custom entry
          </button>
        )}
        {unrolled.length > 0 && (
          <button type="button" onClick={() => dispatch(combatActions.rollInitiative.create({ ids: unrolled.map((c) => c.id) }))}>
            Roll initiative ({unrolled.length})
          </button>
        )}
        {gm && !combat.active && combat.combatants.length > 0 && (
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (await confirmDialog({ title: 'Clear turn order?', message: 'Remove all combatants from the turn tracker?', confirmLabel: 'Clear', danger: true })) {
                dispatch(combatActions.end.create({ clear: true }));
              }
            }}
          >
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

const MAX_ROW_CONDITIONS = 3;

function CombatRow({
  combatant: c,
  token,
  character,
  hpShown,
  canFocus,
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
  token: Token | undefined;
  /** Linked character the viewer can see. */
  character: Character | undefined;
  hpShown: boolean;
  canFocus: boolean;
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
        {isCurrent && <ChevronRight size={14} className="combat-current-icon" aria-label="Current turn" />}
        {token && <CombatantAvatar token={token} portraitUrl={character?.bio.portraitUrl ?? null} />}
        {canFocus ? (
          <button type="button" className="combat-name link-like" title={`${name} — select & center on map`} onClick={() => token && focusToken(token.id)}>
            {name}
          </button>
        ) : (
          <span className="combat-name" title={name}>
            {name}
          </span>
        )}
        {hidden && <span className="badge subtle" title={tokenHidden ? 'Its token is hidden' : undefined}>hidden</span>}
        {character && (
          <button
            type="button"
            className="icon-button combat-sheet-button"
            title={`Open ${character.name}'s character sheet`}
            aria-label={`Open ${character.name}'s character sheet`}
            onClick={() => openCharacterSheet(character.id)}
          >
            <BookOpen size={12} />
          </button>
        )}
      </div>
      {token && (hpShown || token.conditions.length > 0) && (
        <div className="combat-status">
          {hpShown && token.hp && <CombatHp hp={token.hp} />}
          {token.conditions.length > 0 && <CombatConditions conditions={token.conditions} />}
        </div>
      )}
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
          <button type="button" className="icon-button" title="Roll initiative" aria-label="Roll initiative" onClick={() => dispatch(combatActions.rollInitiative.create({ ids: [c.id] }))}>
            <Dices size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Move up"
            aria-label="Move up"
            disabled={!prevId}
            onClick={() => prevId && dispatch(combatActions.move.create({ id: c.id, beforeId: prevId }))}
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Move down (delay)"
            aria-label="Move down"
            disabled={isLast}
            onClick={() => dispatch(combatActions.move.create({ id: c.id, beforeId: nextNextId }))}
          >
            <ArrowDown size={13} />
          </button>
          {gm && (
            <button
              type="button"
              className="icon-button"
              disabled={tokenHidden}
              title={tokenHidden ? 'Hidden because its token is hidden' : c.hidden ? 'Reveal to players' : 'Hide from players'}
              aria-label={c.hidden ? 'Reveal' : 'Hide'}
              onClick={() => update({ hidden: !c.hidden })}
            >
              {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
          <button type="button" className="icon-button" title="Remove" aria-label="Remove" onClick={() => dispatch(combatActions.remove.create({ id: c.id }))}>
            <X size={13} />
          </button>
        </div>
      )}
    </li>
  );
}

function CombatantAvatar({ token, portraitUrl }: { token: Token; portraitUrl: string | null }) {
  const src = token.imageUrl ?? portraitUrl;
  return src ? (
    <img className="combat-avatar" src={src} alt="" style={{ borderColor: token.color }} />
  ) : (
    <span className="combat-avatar dot" style={{ background: token.color }} aria-hidden="true" />
  );
}

function CombatHp({ hp }: { hp: NonNullable<Token['hp']> }) {
  const pct = Math.max(0, Math.min(100, (hp.value / Math.max(1, hp.max)) * 100));
  const label = `${hp.value}/${hp.max}${hp.temp ? ` (+${hp.temp} temp)` : ''} HP`;
  return (
    <span className="combat-hp" title={label} aria-label={label}>
      <span className="combat-hp-bar">
        <span style={{ width: `${pct}%`, background: hpColor(hp.value, hp.max) }} />
      </span>
      <span className="combat-hp-text tnum">
        {hp.value}/{hp.max}
        {hp.temp ? <span className="temp-hp">+{hp.temp}</span> : null}
      </span>
    </span>
  );
}

function CombatConditions({ conditions }: { conditions: string[] }) {
  const shown = conditions.slice(0, MAX_ROW_CONDITIONS);
  const rest = conditions.slice(MAX_ROW_CONDITIONS);
  return (
    <span className="combat-conditions">
      {shown.map((name) => (
        <span key={name} className="combat-condition" style={{ background: conditionStyle(name).color }} title={name}>
          {name}
        </span>
      ))}
      {rest.length > 0 && (
        <span className="combat-condition more" title={rest.join(', ')}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}
