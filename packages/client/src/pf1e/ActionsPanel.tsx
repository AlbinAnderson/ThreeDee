/**
 * PF1e combat actions (#20, #21, #22): what you can do this turn, what it
 * costs, whether it provokes, and your class resources. In combat, taking an
 * action spends the matching part of your turn; outside combat it just
 * announces the action, so the panel doubles as a rules reference.
 */
import { useMemo, useState } from 'react';
import { Dices, Moon, Play } from 'lucide-react';
import {
  canControlCombatant,
  canManageCharacter,
  canSpend,
  characterPools,
  characterResources,
  classActionSetsFor,
  combatActions,
  combatantName,
  computeCharacterStats,
  COST_LABEL,
  effectiveTurn,
  GENERIC_ACTIONS,
  newId,
  pf1eTurnActions,
  SIZE_MOD,
  signed,
  toggleAttackPenalty,
  type ActionCost,
  type ActionGroup,
  type Character,
  type EffectiveTurn,
  type Pf1Action,
} from '@vtt/shared';
import { create } from 'zustand';
import { rollCheck } from '../characters/characterActions';
import { CombatToggles } from '../characters/CombatToggles';
import { InfoTip } from '../components/InfoTip';
import { confirmDialog } from '../state/dialogs';
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

export function resetActionsUi() {
  useActionsUi.setState({ actorKey: null });
}

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
        out.push({ key: `cb:${cb.id}`, label: character?.name ?? combatantName(state, cb), combatantId: cb.id, character });
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

const PROVOKES_BADGE: Record<Pf1Action['provokes'], [string, string, string]> = {
  yes: [
    'AoO',
    'Provokes Attacks of Opportunity',
    'Enemies who threaten your square can immediately make an Attack of Opportunity against you (unless prevented by a feat such as Improved Trip or casting defensively).',
  ],
  no: ['safe', 'Safe (no AoO)', 'Does not provoke Attacks of Opportunity from threatening enemies.'],
  varies: [
    'AoO?',
    'May provoke (AoO?)',
    'Whether this provokes depends on the specific option used — check the action notes (e.g., scrolls & spell-like abilities provoke; wands & Su/Ex abilities do not).',
  ],
  ranged: [
    'AoO*',
    'Provokes if ranged or unarmed (AoO*)',
    'Making a ranged attack or an unarmed strike (without Improved Unarmed Strike) provokes Attacks of Opportunity. Armed melee attacks do not provoke.',
  ],
};

const COST_GLOSSARY: Record<ActionCost, [string, string]> = {
  standard: ['Standard action', '1 per turn. Attack, cast most spells, or use an active ability. Can also be traded down for a second Move action.'],
  move: ['Move action', '1 per turn (or 2 by trading your Standard action). Move up to your speed, stand up, draw a weapon, or retrieve an item.'],
  fullRound: [
    'Full-round action',
    'Consumes both your Standard and Move actions for the turn. You can still take a 5-foot step (if you did not otherwise move), a Swift action, and Free actions.',
  ],
  swift: [
    'Swift action',
    '1 per turn, on your turn only. Very fast ability (e.g., Smite, Judgment, Quickened spell). Using an off-turn Immediate action consumes your next turn’s Swift action.',
  ],
  immediate: [
    'Immediate action',
    '1 per round, usable even outside your turn (not while flat-footed). Uses your Swift action if taken on your turn, or your next turn’s Swift action if taken off-turn.',
  ],
  free: ['Free action', 'Takes almost no time; you can perform one or more per turn alongside other actions (subject to GM limits). Normally on your turn only.'],
  fiveFoot: ['5-foot step', 'Move 5 feet without provoking Attacks of Opportunity. Once per turn, and only if you do not move any other distance during the same turn.'],
  aoo: [
    'Attack of Opportunity',
    'A single extra melee attack triggered when a foe in your threatened area lowers their guard. Normally 1/round (1 + Dex mod with Combat Reflexes); none while flat-footed.',
  ],
  none: ['No action', 'Automatic or part of another action — does not consume any of your turn’s action slots.'],
  other: ['Out of combat / Varies', 'Takes longer than 1 round (e.g. 1 minute or 1 hour) or varies by specific ability; check the action notes.'],
};

export function ActionsPanel() {
  const actors = useActors();
  const actorKey = useActionsUi((s) => s.actorKey);
  const actor = actors.find((a) => a.key === actorKey) ?? actors[0];
  const state = useGame((s) => s);
  const self = useSelf();
  const [query, setQuery] = useState('');

  const econ: EffectiveTurn | null = actor?.combatantId && state.combat.active ? effectiveTurn(state, actor.combatantId) : null;
  const stats = useMemo(() => (actor?.character ? computeCharacterStats(actor.character) : null), [actor?.character]);
  const classSets = useMemo(() => (actor?.character ? classActionSetsFor(actor.character.build.classes) : []), [actor?.character]);
  const resources = useMemo(() => (actor?.character ? characterResources(actor.character) : []), [actor?.character]);
  const pools = useMemo(() => (actor?.character ? characterPools(actor.character) : []), [actor?.character]);

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
  const genericMelee = stats ? stats.bab.total + stats.abilities.STR.mod + SIZE_MOD[stats.size] + toggleAttackPenalty(stats.toggles, stats.bab.total, true) : 0;
  const genericRanged = stats ? stats.bab.total + stats.abilities.DEX.mod + SIZE_MOD[stats.size] + toggleAttackPenalty(stats.toggles, stats.bab.total, false) : 0;
  const roll = stats
    ? (a: Pf1Action) => {
        if (a.roll === 'cmb') return rollCheck(actor.character!, `${a.name} (CMB)`, stats.cmb.total);
        // Use the wielded weapon when there is one (Inventory tab), else a bare BAB + ability + toggle roll.
        const ranged = a.roll === 'ranged';
        const weapon = stats.attacks.find((x) => (ranged ? x.mode !== 'melee' : x.mode === 'melee') && x.hand !== 'offHand');
        const charge = a.id === 'g.charge' ? 2 : 0;
        if (weapon) return rollCheck(actor.character!, `${a.name} (${weapon.name})`, weapon.attack.total + charge);
        if (ranged) rollCheck(actor.character!, `${a.name} (ranged)`, genericRanged);
        else rollCheck(actor.character!, `${a.name} (melee)`, genericMelee + charge);
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
          <button type="button" className="small rollable tnum" onClick={() => rollCheck(actor.character!, 'Melee attack', genericMelee)}>
            <Dices size={12} /> Melee {signed(genericMelee)}
          </button>
          <button type="button" className="small rollable tnum" onClick={() => rollCheck(actor.character!, 'Ranged attack', genericRanged)}>
            <Dices size={12} /> Ranged {signed(genericRanged)}
          </button>
          <button type="button" className="small rollable tnum" onClick={() => rollCheck(actor.character!, 'Combat maneuver (CMB)', stats.cmb.total)}>
            <Dices size={12} /> CMB {signed(stats.cmb.total)}
          </button>
        </div>
      )}
      {stats && actor.character && <CombatToggles character={actor.character} stats={stats} />}

      {pools.length > 0 && (
        <section>
          <div className="section-header">
            <h3>Resources</h3>
            {canManageCharacter(self, actor.character!) && (
              <button
                type="button"
                className="small"
                title="Restore all daily uses (after 8 hours of rest)"
                onClick={async () => {
                  if (await confirmDialog({ title: 'Rest 8 hours?', message: 'Restore all daily uses, spell slots, and prepared spells?', confirmLabel: 'Rest' })) {
                    dispatch(pf1eTurnActions.resetUses.create({ characterId: actor.character!.id }));
                  }
                }}
              >
                <Moon size={12} /> Rest
              </button>
            )}
          </div>
          <ul className="resource-list">
            {pools.map((p) => {
              const left = Math.max(0, p.max - p.used);
              const manage = canManageCharacter(self, actor.character!);
              return (
                <li key={p.key} title={p.className ? `${p.className} class resource` : 'Custom pool'}>
                  <span className="flex1">{p.name}</span>
                  <span className={left === 0 ? 'warn-text' : ''}>
                    {left}/{p.max} {p.unit}
                  </span>
                  <span className="resource-bar">
                    <span style={{ width: `${p.max ? (left / p.max) * 100 : 0}%` }} />
                  </span>
                  {manage && (
                    <>
                      <button
                        type="button"
                        className="small"
                        aria-label={`Use 1 ${p.name}`}
                        disabled={left === 0}
                        onClick={() => dispatch(pf1eTurnActions.adjustUse.create({ characterId: actor.character!.id, key: p.key, delta: 1 }))}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="small"
                        aria-label={`Restore 1 ${p.name}`}
                        disabled={p.used === 0}
                        onClick={() => dispatch(pf1eTurnActions.adjustUse.create({ characterId: actor.character!.id, key: p.key, delta: -1 }))}
                      >
                        +
                      </button>
                    </>
                  )}
                </li>
              );
            })}
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
  const aooBlocked = econ.flatFooted && !econ.combatReflexes;
  const aooLeft = aooBlocked ? 0 : Math.max(0, econ.aooMax - t.aoo);
  const offTurnImmUsed = !econ.isTurn && t.immediateLock !== null && t.immediateLock > t.window;
  return (
    <div className="turn-box">
      <div className="turn-status">
        {econ.isTurn ? <strong>Your turn</strong> : <span className="muted">Waiting for your turn</span>}
        {econ.flatFooted && <span className="badge warn">flat-footed</span>}
      </div>
      <div className="turn-pips">
        {(
          [
            ['Standard', t.standard || t.fullRound, 'standard'],
            ['Move', t.move || t.fullRound, 'move'],
            ['Swift', t.swift, 'swift'],
            ['5-ft', t.fiveFoot || t.moved, 'fiveFoot'],
          ] as [string, boolean, ActionCost][]
        ).map(([label, used, costKey]) => {
          const [gTitle, gBody] = COST_GLOSSARY[costKey];
          return (
            <InfoTip key={label} title={`${gTitle} (${used ? 'used' : 'available'})`} body={gBody} hint="Click to pin" clickToPin>
              <button type="button" className={`pip pip-btn${used ? ' used' : ''}`}>
                {label}
              </button>
            </InfoTip>
          );
        })}
        {offTurnImmUsed && (
          <InfoTip title="Immediate action (used off-turn)" body={COST_GLOSSARY.immediate[1]} hint="Click to pin" clickToPin>
            <button type="button" className="pip pip-btn used">
              Immediate
            </button>
          </InfoTip>
        )}
        <InfoTip
          title={`Attacks of Opportunity (${aooLeft}/${econ.aooMax})`}
          body={aooBlocked ? 'Flat-footed creatures cannot make Attacks of Opportunity (unless they have Combat Reflexes).' : COST_GLOSSARY.aoo[1]}
          hint="Click to pin"
          clickToPin
        >
          <button type="button" className={`pip pip-btn${aooLeft <= 0 ? ' used' : ''}`}>
            AoO {aooLeft}/{econ.aooMax}
          </button>
        </InfoTip>
      </div>
      <div className="button-row">
        <button type="button" className="small" title="Undo: get your whole turn back" onClick={() => dispatch(pf1eTurnActions.resetTurn.create({ combatantId }))}>
          Reset turn
        </button>
        {econ.isTurn && (
          <button
            type="button"
            className="small primary"
            onClick={() => {
              useActionsUi.setState({ actorKey: null });
              dispatch(combatActions.next.create({}));
            }}
          >
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
        const cost = a.resourceCost ?? 1;
        const remaining = uses ? Math.max(0, uses.max - uses.used) : 0;
        const out = uses ? uses.used + cost > uses.max : false;
        const blocked = spend !== true ? spend : out ? (remaining > 0 ? `Needs ${cost} (only ${remaining} left)` : 'None left today') : null;
        const [badge, badgeTitle, badgeBody] = PROVOKES_BADGE[a.provokes];
        const [costTitle, costBody] = COST_GLOSSARY[a.cost];
        const tipBody = `${a.notes}${blocked ? `\n\nBlocked: ${blocked}` : ''}`;
        return (
          <li key={a.id} className={blocked ? 'blocked' : ''}>
            <div className="action-card">
              <InfoTip title={a.name} body={tipBody} hint={blocked ? undefined : 'Click to take action'}>
                <button
                  type="button"
                  className="action-main"
                  disabled={!onAct || !!blocked}
                  onClick={() => onAct?.(a)}
                >
                  <span className="action-name">{a.name}</span>
                </button>
              </InfoTip>
              <span className="action-meta">
                <InfoTip title={a.costLabel ? `${costTitle} (${a.costLabel})` : costTitle} body={costBody} hint="Click badge to pin" clickToPin>
                  <button type="button" className={`cost-badge badge-btn cost-${a.cost}`} aria-label={`Explain ${a.costLabel ?? COST_LABEL[a.cost]}`}>
                    {a.costLabel ?? COST_LABEL[a.cost]}
                  </button>
                </InfoTip>
                <InfoTip title={badgeTitle} body={badgeBody} hint="Click badge to pin" clickToPin>
                  <button type="button" className={`aoo-badge badge-btn aoo-${a.provokes}`} aria-label={`Explain ${badge}`}>
                    {badge}
                  </button>
                </InfoTip>
                {uses && (
                  <span className="muted small-text tnum">
                    {remaining}/{uses.max}
                  </span>
                )}
              </span>
            </div>
            {a.roll && onRoll && (
              <button type="button" className="icon-button" title="Roll attack / CMB" onClick={() => onRoll(a)}>
                <Dices size={14} />
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
          useActionsUi.setState({ actorKey: null });
          useUi.getState().setSidebarPanel('actions');
        }}
      >
        Actions
      </button>
      <button
        type="button"
        className="small gold"
        onClick={() => {
          useActionsUi.setState({ actorKey: null });
          dispatch(combatActions.next.create({}));
        }}
      >
        End turn <Play size={11} />
      </button>
    </div>
  );
}
