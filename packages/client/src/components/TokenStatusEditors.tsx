/** Inspector sections for a token's HP, conditions, darkvision and carried light. */
import { useState } from 'react';
import { tokenActions, type Token } from '@vtt/shared';
import { CONDITION_PRESETS, conditionStyle, hpColor } from '../config/conditions';
import { dispatch } from '../state/dispatch';
import { CheckboxField, ColorField, NumberField } from './fields';

type Changes = Parameters<typeof tokenActions.update.create>[0]['changes'];
const updater = (token: Token) => (changes: Changes) => dispatch(tokenActions.update.create({ id: token.id, changes }));

/** Apply damage (temp HP soaks it first) or healing (capped at max). */
export function applyHpDelta(hp: NonNullable<Token['hp']>, delta: number): NonNullable<Token['hp']> {
  if (delta >= 0) return { ...hp, value: Math.min(hp.max, hp.value + delta) };
  let dmg = -delta;
  const soaked = Math.min(hp.temp, dmg);
  dmg -= soaked;
  return { ...hp, temp: hp.temp - soaked, value: hp.value - dmg };
}

export function HpEditor({ token }: { token: Token }) {
  const update = updater(token);
  const [amount, setAmount] = useState('');
  const hp = token.hp;

  if (!hp) {
    return (
      <button type="button" className="small" onClick={() => update({ hp: { value: 10, max: 10, temp: 0 } })}>
        + Add HP bar
      </button>
    );
  }

  function apply(sign: 1 | -1) {
    const n = Math.abs(Math.round(Number(amount)));
    if (!n || !hp) return;
    update({ hp: applyHpDelta(hp, sign * n) });
    setAmount('');
  }

  return (
    <div className="hp-editor">
      <div className="hp-bar-html" title={`${hp.value} / ${hp.max}${hp.temp ? ` (+${hp.temp} temp)` : ''}`}>
        <div style={{ width: `${Math.max(0, Math.min(100, (hp.value / Math.max(1, hp.max)) * 100))}%`, background: hpColor(hp.value, hp.max) }} />
      </div>
      <div className="field-row">
        <NumberField label="HP" value={hp.value} min={-100000} max={100000} step={1} onCommit={(value) => update({ hp: { ...hp, value: Math.round(value) } })} />
        <NumberField label="Max" value={hp.max} min={0} max={100000} step={1} onCommit={(max) => update({ hp: { ...hp, max: Math.round(max) } })} />
        <NumberField label="Temp" value={hp.temp} min={0} max={100000} step={1} onCommit={(temp) => update({ hp: { ...hp, temp: Math.round(temp) } })} />
      </div>
      <div className="field-row hp-quick">
        <input
          type="number"
          min={0}
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply(-1)}
        />
        <button type="button" className="small danger" onClick={() => apply(-1)} title="Damage (temp HP first). Enter also applies damage.">
          Damage
        </button>
        <button type="button" className="small" onClick={() => apply(1)}>
          Heal
        </button>
      </div>
      <div className="button-row">
        <CheckboxField label="Everyone sees HP" value={token.hpVisible} onCommit={(hpVisible) => update({ hpVisible })} />
        <button type="button" className="link-button" onClick={() => update({ hp: null })}>
          Remove bar
        </button>
      </div>
    </div>
  );
}

export function ConditionsEditor({ token }: { token: Token }) {
  const update = updater(token);
  const [custom, setCustom] = useState('');
  const has = (name: string) => token.conditions.some((c) => c.toLowerCase() === name.toLowerCase());
  const toggle = (name: string) =>
    update({
      conditions: has(name) ? token.conditions.filter((c) => c.toLowerCase() !== name.toLowerCase()) : [...token.conditions, name].slice(0, 30),
    });
  const customOnes = token.conditions.filter((c) => !CONDITION_PRESETS.some((p) => p.name.toLowerCase() === c.toLowerCase()));

  return (
    <div className="conditions-editor">
      <div className="condition-chips">
        {[...CONDITION_PRESETS.map((p) => p.name), ...customOnes].map((name) => {
          const style = conditionStyle(name);
          const on = has(name);
          return (
            <button
              key={name}
              type="button"
              className={`condition-chip${on ? ' on' : ''}`}
              style={on ? { background: style.color, borderColor: style.color } : undefined}
              onClick={() => toggle(name)}
            >
              <span className="condition-icon">{style.icon}</span>
              {name}
            </button>
          );
        })}
      </div>
      <form
        className="field-row"
        onSubmit={(e) => {
          e.preventDefault();
          const name = custom.trim().slice(0, 40);
          if (name && !has(name)) toggle(name);
          setCustom('');
        }}
      >
        <input placeholder="Custom condition…" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button type="submit" className="small">
          Add
        </button>
      </form>
      <ConditionTimers conditions={token.conditions} rounds={token.conditionRounds} onChange={(conditionRounds) => update({ conditionRounds })} />
    </div>
  );
}

/**
 * Optional round countdowns for active conditions: they tick down at the
 * start of the token's turn in combat and the condition ends at 0.
 */
export function ConditionTimers({
  conditions,
  rounds,
  onChange,
}: {
  conditions: string[];
  rounds: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  if (!conditions.length) return null;
  const set = (name: string, text: string) => {
    const n = Math.round(Number(text));
    const next = { ...rounds };
    if (!text.trim() || !Number.isFinite(n) || n < 1) delete next[name];
    else next[name] = Math.min(10000, n);
    onChange(next);
  };
  return (
    <div className="condition-timers">
      <span className="muted small-text">Rounds left (counts down on this token's turn; blank = until removed):</span>
      {conditions.map((name) => (
        <label key={name} className="condition-timer">
          <span>{name}</span>
          <TimerInput value={rounds[name] ?? null} onCommit={(t) => set(name, t)} label={`${name} rounds left`} />
        </label>
      ))}
    </div>
  );
}

/** A small rounds box that commits on blur / Enter. */
export function TimerInput({ value, onCommit, label }: { value: number | null; onCommit: (text: string) => void; label: string }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value === null ? '' : String(value));
  }
  const commit = () => {
    if (draft !== (value === null ? '' : String(value))) onCommit(draft);
  };
  return (
    <input
      type="number"
      className="timer-input"
      min={1}
      max={10000}
      placeholder="∞"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

export function VisionEditor({ token }: { token: Token }) {
  const update = updater(token);
  const light = token.light;
  return (
    <>
      <NumberField
        label="Darkvision (cells)"
        value={token.darkvision}
        min={0}
        max={200}
        step={1}
        onCommit={(darkvision) => update({ darkvision })}
      />
      <CheckboxField
        label="Carries a light"
        value={!!light}
        onCommit={(on) => update({ light: on ? { bright: 4, dim: 8, color: '#ffd27a' } : null })}
      />
      {light && (
        <div className="field-row">
          <NumberField label="Bright" value={light.bright} min={0} max={200} onCommit={(bright) => update({ light: { ...light, bright } })} />
          <NumberField label="Dim" value={light.dim} min={0} max={400} onCommit={(dim) => update({ light: { ...light, dim } })} />
          <ColorField label="Color" value={light.color} onCommit={(color) => update({ light: { ...light, color } })} />
        </div>
      )}
      <p className="muted small-text">Radii are in grid cells (on a 5 ft grid, a torch is 4 bright / 8 dim).</p>
    </>
  );
}
