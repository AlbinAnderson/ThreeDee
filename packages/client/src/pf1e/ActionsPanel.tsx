/**
 * PF1e combat actions (#20, #21, #22): what you can do this turn, what it
 * costs, whether it provokes, and your class resources. In combat, taking an
 * action spends the matching part of your turn; outside combat it just
 * announces the action, so the panel doubles as a rules reference.
 */
import { useMemo, useState } from 'react';
import {
  canControlCombatant,
  canManageCharacter,
  canSpend,
  characterResources,
  classActionSetsFor,
  combatActions,
  computeCharacterStats,
  COST_LABEL,
  effectiveTurn,
  GENERIC_ACTIONS,
  newId,
  pf1eTurnActions,
  SIZE_MOD,
  signed,
  type ActionGroup,
  type Character,
  type EffectiveTurn,
  type Pf1Action,
} from '@vtt/shared';
import { create } from 'zustand';
import { rollCheck } from '../characters/characterActions';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { useUi } from '../state/uiStore';

/** Who is acting: a combatant (in combat), a character, or both when linked. */
interface Actor {
  key: string;
  label: string;
  combatantId?: string;
  character?: Character;
}

export const useActionsUi = create<{ actorKey: string | null }>(() => ({ actorKey: null }));

/** Characters and combatants the current user can act for; the one whose turn it is first. */
export function useActors(): Actor[] {
  const state = useGame((s) => s);
  const self = useSelf();
  return useMemo(() => {
    const out: Actor[] = [];
    const { combat } = state;
    if (combat.active) {
      for (const cb of combat.combatants) {
        if (!canControlCombatant(state, self, cb)) continue;
        const character = cb.tokenId ? Object.values(state.characters).find((c) => c.tokenId === cb.tokenId) : undefined;
        out.push({ key: `cb:${cb.id}`, label: character?.name ?? cb.name, combatantId: cb.id, character });
      }
      out.sort((a, b) => Number(b.combatantId === combat.currentId) - Number(a.combatantId === combat.currentId));
    }
    for (const c of Object.values(state.characters)) {
      if (!canManageCharacter(self, c) || out.some((a) => a.character?.id === c.id)) continue;
      out.push({ key: `ch:${c.id}`, label: c.name, character: c });
    }
    return out;
  }, [state, self]);
}

const GROUPS: [ActionGroup, string][] = [
  ['standard', 'Standard actions'],
  ['move', 'Move actions'],
  ['fullRound', 'Full-round actions'],
  ['maneuver', 'Combat maneuvers'],
  ['other', 'Free, swift, immediate & non-actions'],
];

const PROVOKES_BADGE: Record<Pf1Action['provokes'], [string, string]> = {
  yes: ['AoO', 'Provokes attacks of opportunity'],
  no: ['safe', 'Doesn’t provoke'],
  varies: ['AoO?', 'May provoke (see notes)'],
  ranged: ['AoO*', 'Provokes when ranged (or unarmed without Improved Unarmed Strike)'],
};

export function ActionsPanel() {
  const actors = useActors();
  const actorKey = useActionsUi((s) => s.actorKey);
  const actor = actors.find((a) => a.key === actorKey) ?? actors[0];
  const state = useGame((s) => s);
  const [query, setQuery] = useState('');

  const econ: EffectiveTurn | null = actor?.combatantId && state.combat.active ? effectiveTurn(state, actor.combatantId) : null;
  const stats = useMemo(() => (actor?.character ? computeCharacterStats(actor.character) : null), [actor?.character]);
  const classSets = useMemo(() => (actor?.character ? classActionSetsFor(actor.character.build.classes) : []), [actor?.character]);
  const resources = useMemo(() => (actor?.character ? characterResources(actor.character) : []), [actor?.character]);

  if (!actor) {
    return (
      <div className="panel-scroll">
        <p className="muted">Import a character (📇) or add your token to combat (⚔) to use the actions panel.</p>
        <ActionList actions={GENERIC_ACTIONS} econ={null} onAct={null} />
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (a: Pf1Action) => !q || a.name.toLowerCase().includes(q) || a.notes.toLowerCase().includes(q);
  const act = (a: Pf1Action) =>
    dispatch(pf1eTurnActions.act.create({ actionId: a.id, combatantId: actor.combatantId, characterId: actor.combatantId ? undefined : actor.character?.id, chatId: newId() }));
  const roll = stats
    ? (a: Pf1Action) => {
        const size = SIZE_MOD[stats.size];
        if (a.roll === 'cmb') rollCheck(actor.character!, `${a.name} (CMB)`, stats.cmb.total);
        else if (a.roll === 'ranged') rollCheck(actor.character!, `${a.name} (ranged)`, stats.bab.total + stats.abilities.DEX.mod + size);
        else rollCheck(actor.character!, `${a.name} (melee)`, stats.bab.total + stats.abilities.STR.mod + size + (a.id === 'g.charge' ? 2 : 0));
      }
    : null;

  return (
    <div className="panel-scroll actions-panel">
      <div className="field">
        <label>Acting</label>
        <select value={actor.key} onChange={(e) => useActionsUi.setState({ actorKey: e.target.value })}>
          {actors.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
              {a.combatantId === state.combat.currentId ? ' (their turn)' : a.combatantId ? ' (in combat)' : ''}
            </option>
          ))}
        </select>
      </div>

      {econ ? <TurnPips econ={econ} combatantId={actor.combatantId!} /> : <p className="muted small-text">Not in combat: actions are announced in chat without tracking turns.</p>}

      {stats && (
        <div className="button-row">
          <button type="button" className="small" onClick={() => rollCheck(actor.character!, 'Melee attack', stats.bab.total + stats.abilities.STR.mod + SIZE_MOD[stats.size])}>
            🎲 Melee {signed(stats.bab.total + stats.abilities.STR.mod + SIZE_MOD[stats.size])}
          </button>
          <button type="button" className="small" onClick={() => rollCheck(actor.character!, 'Ranged attack', stats.bab.total + stats.abilities.DEX.mod + SIZE_MOD[stats.size])}>
            🎲 Ranged {signed(stats.bab.total + stats.abilities.DEX.mod + SIZE_MOD[stats.size])}
          </button>
          <button type="button" className="small" onClick={() => rollCheck(actor.character!, 'Combat maneuver (CMB)', stats.cmb.total)}>
            🎲 CMB {signed(stats.cmb.total)}
          </button>
        </div>
      )}
      {stats && <p className="muted small-text">Generic attack bonus (BAB + ability + size); weapons come with the inventory update.</p>}

      {resources.length > 0 && (
        <section>
          <div className="section-header">
            <h3>Resources</h3>
            <button
              type="button"
              className="small"
              title="Restore all daily uses (after 8 hours of rest)"
              onClick={() => confirm('Restore all daily uses?') && dispatch(pf1eTurnActions.resetUses.create({ characterId: actor.character!.id }))}
            >
              Rest
            </button>
          </div>
          <ul className="resource-list">
            {resources.map((r) => (
              <li key={r.key} title={`${r.set.className} ${r.level}`}>
                <span className="flex1">{r.def.name}</span>
                <span className={r.used >= r.max ? 'warn-text' : ''}>
                  {Math.max(0, r.max - r.used)}/{r.max} {r.def.unit}
                </span>
                <span className="resource-bar">
                  <span style={{ width: `${r.max ? Math.max(0, (r.max - r.used) / r.max) * 100 : 0}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <input className="actions-search" placeholder="Search actions…" value={query} onChange={(e) => setQuery(e.target.value)} />

      {classSets.map(({ set }) => {
        const list = set.actions.filter(matches);
        if (!list.length) return null;
        return (
          <section key={set.className}>
            <h3>{set.className}</h3>
            <ActionList actions={list} econ={econ} onAct={act} onRoll={roll} usesFor={(a) => resources.find((r) => r.set === set && r.def.id === a.resource)} />
          </section>
        );
      })}

      {GROUPS.map(([group, title]) => {
        const list = GENERIC_ACTIONS.filter((a) => a.group === group && matches(a));
        if (!list.length) return null;
        return (
          <section key={group}>
            <h3>{title}</h3>
            <ActionList actions={list} econ={econ} onAct={act} onRoll={roll} />
          </section>
        );
      })}
    </div>
  );
}

function TurnPips({ econ, combatantId }: { econ: EffectiveTurn; combatantId: string }) {
  const t = econ.turn;
  const pips: [string, boolean, string][] = [
    ['Standard', t.standard || t.fullRound, 'Standard action'],
    ['Move', t.move || t.fullRound, 'Move action (a standard can become a second move)'],
    ['Swift', t.swift, 'Swift action (an immediate action uses it)'],
    ['5-ft', t.fiveFoot || t.moved, '5-foot step (not if you moved)'],
  ];
  return (
    <div className="turn-box">
      <div className="turn-status">
        {econ.isTurn ? <strong>Your turn</strong> : <span className="muted">Waiting for your turn</span>}
        {econ.flatFooted && <span className="badge warn">flat-footed</span>}
      </div>
      <div className="turn-pips">
        {pips.map(([label, used, title]) => (
          <span key={label} className={`pip${used ? ' used' : ''}`} title={`${title}: ${used ? 'used' : 'available'}`}>
            {label}
          </span>
        ))}
        <span className={`pip${econ.turn.aoo >= econ.aooMax ? ' used' : ''}`} title="Attacks of opportunity this round">
          AoO {econ.aooMax - econ.turn.aoo}/{econ.aooMax}
        </span>
      </div>
      <div className="button-row">
        <button type="button" className="small" title="Undo: get your whole turn back" onClick={() => dispatch(pf1eTurnActions.resetTurn.create({ combatantId }))}>
          Reset turn
        </button>
        {econ.isTurn && (
          <button type="button" className="small primary" onClick={() => dispatch(combatActions.next.create({}))}>
            End turn ▶
          </button>
        )}
      </div>
    </div>
  );
}

function ActionList({
  actions,
  econ,
  onAct,
  onRoll,
  usesFor,
}: {
  actions: Pf1Action[];
  econ: EffectiveTurn | null;
  onAct: ((a: Pf1Action) => void) | null;
  onRoll?: ((a: Pf1Action) => void) | null;
  usesFor?: (a: Pf1Action) => { used: number; max: number } | undefined;
}) {
  return (
    <ul className="action-list">
      {actions.map((a) => {
        const spend = econ ? canSpend(econ, a.cost, a.movement) : true;
        const uses = a.resource ? usesFor?.(a) : undefined;
        const out = uses ? uses.used >= uses.max : false;
        const blocked = spend !== true ? spend : out ? 'None left today' : null;
        const [badge, badgeTitle] = PROVOKES_BADGE[a.provokes];
        return (
          <li key={a.id} className={blocked ? 'blocked' : ''}>
            <button
              type="button"
              className="action-main"
              disabled={!onAct || !!blocked}
              title={`${a.notes}${blocked ? `\n\nCan’t now: ${blocked}` : ''}`}
              onClick={() => onAct?.(a)}
            >
              <span className="action-name">{a.name}</span>
              <span className="action-meta">
                <span className={`cost-badge cost-${a.cost}`}>{a.costLabel ?? COST_LABEL[a.cost]}</span>
                <span className={`aoo-badge aoo-${a.provokes}`} title={badgeTitle}>
                  {badge}
                </span>
                {uses && (
                  <span className="muted small-text">
                    {Math.max(0, uses.max - uses.used)}/{uses.max}
                  </span>
                )}
              </span>
            </button>
            {a.roll && onRoll && (
              <button type="button" className="icon-button" title="Roll it" onClick={() => onRoll(a)}>
                🎲
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Compact strip on the map while it's your turn. */
export function TurnBar() {
  const actors = useActors();
  const state = useGame((s) => s);
  const mine = actors.find((a) => a.combatantId && a.combatantId === state.combat.currentId);
  if (!state.combat.active || !mine?.combatantId) return null;
  const econ = effectiveTurn(state, mine.combatantId);
  const t = econ.turn;
  const pip = (label: string, used: boolean) => <span className={`pip${used ? ' used' : ''}`}>{label}</span>;
  return (
    <div className="turn-bar">
      <strong>{mine.label}</strong>
      {pip('Std', t.standard || t.fullRound)}
      {pip('Move', t.move || t.fullRound)}
      {pip('Swift', t.swift)}
      {pip('5-ft', t.fiveFoot || t.moved)}
      <button
        type="button"
        className="small"
        onClick={() => {
          useActionsUi.setState({ actorKey: mine.key });
          useUi.getState().setSidebarPanel('actions');
        }}
      >
        Actions
      </button>
      <button type="button" className="small primary" onClick={() => dispatch(combatActions.next.create({}))}>
        End turn ▶
      </button>
    </div>
  );
}
