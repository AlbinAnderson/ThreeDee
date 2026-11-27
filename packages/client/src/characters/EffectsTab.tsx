/**
 * Effects (Epic 8): conditions with their PF1e penalties, temporary buffs
 * (presets scaled for the character, or custom typed modifiers), round
 * timers that count down on the character's turn, and what PCGen had on.
 * Every number on the sheet already includes these; hover a number for its
 * breakdown.
 */
import { useMemo, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import {
  buffActions,
  BUFF_PRESETS,
  BuffTargetSchema,
  BonusTypeSchema,
  canControlToken,
  canManageCharacter,
  computeCharacterStats,
  conditionRule,
  describeEffects,
  lookupPreset,
  MAX_BUFFS,
  newId,
  presetBuff,
  presetsFor,
  tempBonusSuggestions,
  tokenActions,
  type Buff,
  type BuffEffect,
  type BuffPreset,
  type Character,
} from '@vtt/shared';
import { ConditionTimers, TimerInput } from '../components/TokenStatusEditors';
import { CONDITION_PRESETS, conditionStyle } from '../config/conditions';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';

export function EffectsTab({ character: c }: { character: Character }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const stats = useMemo(() => computeCharacterStats(c), [c]);
  return (
    <div className="effects">
      <Conditions character={c} manage={manage} />
      <Buffs character={c} manage={manage} />
      {stats.effects.notes.length > 0 && (
        <section>
          <h3>Reminders</h3>
          <ul className="effect-notes small-text">
            {stats.effects.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small-text">
        Bonuses of the same type don’t stack (only the highest counts); dodge, circumstance and untyped bonuses and all penalties add up. Hover any number on
        the Sheet to see what makes it up.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ conditions

function Conditions({ character: c, manage }: { character: Character; manage: boolean }) {
  const self = useSelf();
  const tokens = useGame((s) => s.tokens);
  const token = c.tokenId ? tokens[c.tokenId] : undefined;
  const editable = token ? canControlToken(self, token) : manage;
  const current = token ? token.conditions : c.runtime.conditions;
  const has = (name: string) => current.some((x) => x.toLowerCase() === name.toLowerCase());
  const setList = (next: string[]) => {
    if (token) dispatch(tokenActions.update.create({ id: token.id, changes: { conditions: next.slice(0, 30) } }));
    else dispatch(buffActions.setConditions.create({ characterId: c.id, conditions: next.slice(0, 30) }));
  };
  const toggle = (name: string) => setList(has(name) ? current.filter((x) => x.toLowerCase() !== name.toLowerCase()) : [...current, name]);
  const names = [...CONDITION_PRESETS.map((p) => p.name).filter((n) => !['Dying', 'Stable', 'Dead', 'Concentrating'].includes(n)), ...current.filter((x) => !CONDITION_PRESETS.some((p) => p.name.toLowerCase() === x.toLowerCase()))];
  return (
    <section>
      <div className="section-header">
        <h3>Conditions</h3>
        <span className="muted small-text">{token ? `on token “${token.name}”` : c.tokenId ? 'token not visible' : 'not linked to a token'}</span>
      </div>
      <div className="condition-chips">
        {names.map((name) => {
          const on = has(name);
          const style = conditionStyle(name);
          const rule = conditionRule(name) ?? BUFF_PRESETS.find((p) => p.condition?.toLowerCase() === name.toLowerCase());
          return (
            <button
              key={name}
              type="button"
              disabled={!editable}
              className={`condition-chip${on ? ' on' : ''}${rule ? '' : ' cosmetic'}`}
              style={on ? { background: style.color, borderColor: style.color } : undefined}
              title={rule ? 'Changes your numbers' : 'Marker only'}
              aria-pressed={on}
              onClick={() => toggle(name)}
            >
              <span className="condition-icon">{style.icon}</span>
              {name}
            </button>
          );
        })}
      </div>
      {token && editable && (
        <ConditionTimers
          conditions={token.conditions}
          rounds={token.conditionRounds}
          onChange={(conditionRounds) => dispatch(tokenActions.update.create({ id: token.id, changes: { conditionRounds } }))}
        />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ buffs

function Buffs({ character: c, manage }: { character: Character; manage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const update = (b: Buff, changes: Partial<Buff>) => dispatch(buffActions.update.create({ characterId: c.id, buffId: b.id, changes }));
  const suggestions = useMemo(() => tempBonusSuggestions(c), [c]);
  const missing = suggestions.filter((s) => !c.runtime.buffs.some((b) => b.name.toLowerCase().startsWith(s.name.toLowerCase())));
  const full = c.runtime.buffs.length >= MAX_BUFFS;

  return (
    <section>
      <div className="section-header">
        <h3>Buffs</h3>
      </div>
      {c.runtime.buffs.length === 0 && <p className="muted small-text">No buffs yet. Add a spell, class ability or combat situation below.</p>}
      <ul className="buff-list">
        {c.runtime.buffs.map((b) => (
          <li key={b.id} className={b.active ? 'on' : ''}>
            <div className="buff-head">
              <input type="checkbox" checked={b.active} disabled={!manage} aria-label={`${b.name} active`} onChange={(e) => update(b, { active: e.target.checked })} />
              <span className="buff-name" title={b.note || undefined}>
                {b.name}
              </span>
              {manage ? (
                <TimerInput
                  value={b.roundsLeft}
                  label={`${b.name} rounds left`}
                  onCommit={(t) => {
                    const n = Math.round(Number(t));
                    update(b, { roundsLeft: t.trim() && Number.isFinite(n) && n >= 1 ? Math.min(10000, n) : null });
                  }}
                />
              ) : (
                b.roundsLeft !== null && <span className="small-text">⏱{b.roundsLeft}</span>
              )}
              {manage && (
                <>
                  <button type="button" className="small icon-button" aria-label={`Edit ${b.name}`} onClick={() => setEditing(editing === b.id ? null : b.id)}>
                    <Pencil size={13} />
                  </button>
                  <button type="button" className="small icon-button" aria-label={`Remove ${b.name}`} onClick={() => dispatch(buffActions.remove.create({ characterId: c.id, buffId: b.id }))}>
                    <X size={13} />
                  </button>
                </>
              )}
            </div>
            <div className="muted small-text">{describeEffects(b.effects) || 'No numbers (reminder only)'}</div>
            {editing === b.id && (
              <BuffEditor
                initial={b}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={(next) => {
                  if (dispatch(buffActions.update.create({ characterId: c.id, buffId: b.id, changes: { name: next.name, note: next.note, effects: next.effects } }))) setEditing(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {manage && !full && (
        <>
          <AddPreset character={c} />
          {missing.length > 0 && (
            <div className="button-row small-text">
              <span className="muted">On in PCGen:</span>
              {missing.map((s) => (
                <button key={s.name} type="button" className="small" title={s.preset ? `Add ${s.preset.name}` : 'Add as a reminder; set its numbers with ✎'} onClick={() => addSuggestion(c, s)}>
                  + {s.name}
                </button>
              ))}
            </div>
          )}
          {custom ? (
            <BuffEditor
              initial={{ name: '', note: '', effects: [{ target: 'attack', value: 1, type: 'untyped' }] }}
              submitLabel="Add buff"
              onCancel={() => setCustom(false)}
              onSubmit={(next) => {
                if (dispatch(buffActions.add.create({ characterId: c.id, buff: { id: newId(), presetId: null, active: true, roundsLeft: null, ...next } }))) setCustom(false);
              }}
            />
          ) : (
            <button type="button" className="small" onClick={() => setCustom(true)}>
              + Custom buff…
            </button>
          )}
        </>
      )}
    </section>
  );
}

function addBuff(c: Character, preset: BuffPreset, option?: string) {
  const stats = computeCharacterStats(c);
  const buff = presetBuff(c, preset, option, { mod: (k) => stats.abilities[k].mod }, newId());
  dispatch(buffActions.add.create({ characterId: c.id, buff }));
}

function addSuggestion(c: Character, s: { name: string; description: string | null; preset: BuffPreset | null }) {
  if (s.preset) return addBuff(c, s.preset);
  const note = `From PCGen${s.description ? `: ${s.description}` : ''}. Set its numbers with ✎.`.slice(0, 300);
  dispatch(buffActions.add.create({ characterId: c.id, buff: { id: newId(), presetId: null, name: s.name, effects: [], note, active: true, roundsLeft: null } }));
}

function AddPreset({ character: c }: { character: Character }) {
  const presets = useMemo(() => presetsFor(c), [c]);
  const [id, setId] = useState('');
  const preset = id ? lookupPreset(id) : undefined;
  const [option, setOption] = useState<string | undefined>(undefined);
  const groups = [...new Set(presets.map((p) => p.group))];
  return (
    <div className="buff-add">
      <select
        value={id}
        aria-label="Add a preset buff"
        onChange={(e) => {
          setId(e.target.value);
          const p = lookupPreset(e.target.value);
          setOption(p?.option?.initial(c));
        }}
      >
        <option value="">+ Add a buff…</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {presets
              .filter((p) => p.group === g)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {preset?.option && (
        <select value={option} aria-label={preset.option.label} onChange={(e) => setOption(e.target.value)}>
          {preset.option.choices.map((ch) => (
            <option key={ch.value} value={ch.value}>
              {preset.option!.label}: {ch.label}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="small"
        disabled={!preset}
        onClick={() => {
          if (!preset) return;
          addBuff(c, preset, option);
          setId('');
        }}
      >
        Add
      </button>
      {preset && <span className="muted small-text">{describeEffects(preset.effects(c, option ?? preset.option?.initial(c) ?? '', { mod: (k) => computeCharacterStats(c).abilities[k].mod }))}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ editor

const TARGET_LABEL: Record<BuffEffect['target'], string> = {
  STR: 'Strength',
  DEX: 'Dexterity',
  CON: 'Constitution',
  INT: 'Intelligence',
  WIS: 'Wisdom',
  CHA: 'Charisma',
  attack: 'Attack rolls',
  attackMelee: 'Melee attack rolls',
  attackRanged: 'Ranged attack rolls',
  damage: 'Weapon damage',
  damageMelee: 'Melee damage',
  damageThrown: 'Thrown damage',
  damageRanged: 'Ranged damage',
  ac: 'AC',
  cmb: 'CMB',
  cmd: 'CMD',
  initiative: 'Initiative',
  saves: 'All saves',
  fort: 'Fortitude',
  ref: 'Reflex',
  will: 'Will',
  skills: 'All skill checks',
  speed: 'Speed (ft.)',
  casterLevel: 'Caster level',
  sizeSteps: 'Size (steps)',
  extraAttack: 'Extra attack (haste)',
};

type DraftEffect = { target: BuffEffect['target']; valueText: string; type: BuffEffect['type'] };
type Draft = { name: string; note: string; effects: BuffEffect[] };

const clampEffectValue = (text: string) => {
  const n = Math.round(Number(text));
  return Number.isFinite(n) ? Math.max(-50, Math.min(50, n)) : 0;
};

function BuffEditor({ initial, submitLabel, onSubmit, onCancel }: { initial: Draft; submitLabel: string; onSubmit: (d: Draft) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [note, setNote] = useState(initial.note);
  const [effects, setEffects] = useState<DraftEffect[]>(() => initial.effects.map((x) => ({ target: x.target, valueText: String(x.value), type: x.type })));
  const setEffect = (i: number, changes: Partial<DraftEffect>) => setEffects(effects.map((x, j) => (j === i ? { ...x, ...changes } : x)));
  const submit = () => {
    const cleanName = name.trim().slice(0, 60);
    if (!cleanName) return notify('Give the buff a name');
    const cleanEffects: BuffEffect[] = effects.slice(0, 20).map((x) => ({ target: x.target, value: clampEffectValue(x.valueText), type: x.type }));
    onSubmit({ name: cleanName, note: note.slice(0, 300), effects: cleanEffects });
  };
  return (
    <div className="buff-editor">
      <input placeholder="Name (e.g. Heroism)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      {effects.map((fx, i) => (
        <div key={i} className="buff-effect-row">
          <select value={fx.target} aria-label="Applies to" onChange={(e) => setEffect(i, { target: e.target.value as BuffEffect['target'] })}>
            {BuffTargetSchema.options.map((t) => (
              <option key={t} value={t}>
                {TARGET_LABEL[t]}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={-50}
            max={50}
            value={fx.valueText}
            aria-label="Value"
            onChange={(e) => setEffect(i, { valueText: e.target.value })}
            onBlur={() => setEffect(i, { valueText: String(clampEffectValue(fx.valueText)) })}
          />
          <select value={fx.type} aria-label="Bonus type" onChange={(e) => setEffect(i, { type: e.target.value as BuffEffect['type'] })}>
            {BonusTypeSchema.options.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button type="button" className="small icon-button" aria-label="Remove effect" onClick={() => setEffects(effects.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      {effects.length < 20 && (
        <button type="button" className="small" onClick={() => setEffects([...effects, { target: 'attack', valueText: '1', type: 'untyped' }])}>
          + Effect
        </button>
      )}
      <textarea placeholder="Reminder (what the numbers don’t cover)" value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} />
      <div className="button-row">
        <button type="button" className="primary small" onClick={submit}>
          {submitLabel}
        </button>
        <button type="button" className="small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
