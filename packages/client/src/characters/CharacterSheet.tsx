/** The core PF1e character sheet: live numbers with breakdowns and one-click rolls. */
import { useEffect, useMemo, useState } from 'react';
import {
  canManageCharacter,
  characterHp,
  classSummary,
  computeCharacterStats,
  describeLine,
  saveName,
  signed,
  STAT_KEYS,
  tokenSyncFor,
  type Character,
  type CharacterStats,
  type SaveKey,
  type StatLine,
} from '@vtt/shared';
import { applyHpDelta } from '../components/TokenStatusEditors';
import { rollToChat } from '../panels/ChatPanel';
import { CombatToggles } from './CombatToggles';
import { useGame, useSelf } from '../state/hooks';
import { rollCheck, rollInitiative, setHp, syncLinkedToken, updateRuntime } from './characterActions';

const STAT_NAMES: Record<string, string> = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };

export function CharacterSheet({ character: c, onOpenSettings }: { character: Character; onOpenSettings: () => void }) {
  const self = useSelf();
  const tokens = useGame((s) => s.tokens);
  const scenes = useGame((s) => s.scenes);
  const stats = useMemo(() => computeCharacterStats(c), [c]);
  const manage = canManageCharacter(self, c);
  const b = c.build;
  const token = c.tokenId ? tokens[c.tokenId] : undefined;
  const expectedSync = useMemo(() => (token ? tokenSyncFor({ scenes }, c, token) : null), [scenes, c, token]);
  const lightOutOfDate =
    expectedSync?.light !== undefined &&
    ((token?.light?.bright ?? null) !== (expectedSync.light?.bright ?? null) ||
      (token?.light?.dim ?? null) !== (expectedSync.light?.dim ?? null));
  const tokenOutOfDate =
    !!token &&
    !!expectedSync &&
    (token.hp?.max !== expectedSync.hp.max ||
      token.name !== expectedSync.name ||
      token.darkvision !== expectedSync.darkvision ||
      token.size !== expectedSync.size ||
      lightOutOfDate);

  return (
    <div className="sheet">
      <div className="sheet-identity">
        <div>
          <strong>{[b.attributes.race, classSummary(b)].filter(Boolean).join(' · ')}</strong>
        </div>
        <div className="muted small-text">
          {[
            b.attributes.alignment,
            b.attributes.deity?.name,
            stats.size,
            `Speed ${stats.speed.total} ft`,
            stats.senses.darkvision ? `Darkvision ${stats.senses.darkvision} ft` : null,
            stats.senses.lowLight ? 'Low-light vision' : null,
            b.experience.xp !== null ? `${b.experience.xp} XP` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>

      {stats.warnings.length > 0 && (
        <div className="sheet-warnings">
          {stats.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
          {manage && (
            <button type="button" className="link-button" onClick={onOpenSettings}>
              Open sheet settings →
            </button>
          )}
        </div>
      )}

      <HpBlock character={c} stats={stats} manage={manage} />
      {manage && tokenOutOfDate && (
        <button type="button" className="small sync-hint" onClick={() => syncLinkedToken(c)}>
          ↻ Update token (stats / name / senses)
        </button>
      )}

      <div className="sheet-abilities">
        {STAT_KEYS.map((k) => {
          const a = stats.abilities[k];
          return (
            <button
              key={k}
              type="button"
              className={`sheet-ability${a.damage ? ' damaged' : ''}`}
              title={`${STAT_NAMES[k]}: ${describeLine(a.line)}${a.damage ? `, ${a.damage} damage` : ''}. Click to roll a ${k} check.`}
              onClick={() => rollCheck(c, `${STAT_NAMES[k]} check`, a.mod)}
            >
              <span className="sheet-ability-name">{k}</span>
              <span className="sheet-ability-mod">{signed(a.mod)}</span>
              <span className="sheet-ability-score">{a.score}</span>
            </button>
          );
        })}
      </div>

      <div className="sheet-grid">
        <Stat label="AC" line={stats.ac.normal} />
        <Stat label="Touch" line={stats.ac.touch} />
        <Stat label="Flat-footed" line={stats.ac.flatFooted} />
        <Stat label="CMD" line={stats.cmd} />
      </div>
      <div className="sheet-grid">
        {(['fort', 'ref', 'will'] as SaveKey[]).map((s) => (
          <Stat key={s} label={saveName(s)} line={stats.saves[s]} roll={() => rollCheck(c, `${saveName(s)} save`, stats.saves[s].total)} bonus />
        ))}
      </div>
      <div className="sheet-grid">
        <Stat label="BAB" line={stats.bab} bonus />
        <Stat label="CMB" line={stats.cmb} bonus roll={() => rollCheck(c, 'Combat maneuver (CMB)', stats.cmb.total)} />
        <Stat label="Initiative" line={stats.initiative} bonus roll={() => rollInitiative(c, stats.initiative.total)} />
      </div>
      <p className="muted small-text">Click a highlighted number to roll it (uses your chat mode). Hover for the breakdown.</p>

      <CombatToggles character={c} stats={stats} />
      <Attacks character={c} stats={stats} />
      <div className="muted small-text">
        {[
          `Load: ${stats.load.weight.total} lb (${stats.load.level})`,
          stats.armor.acp ? `check penalty ${stats.armor.acp}` : null,
          stats.armor.asf ? `spell failure ${stats.armor.asf}%` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>

      <details className="inspector-section">
        <summary>Class progression</summary>
        <ul className="sheet-classes">
          {stats.classes.map((k) => (
            <li key={k.name}>
              <strong>
                {k.name} {k.level}
              </strong>{' '}
              {k.chassis ? (
                <span className="muted small-text">
                  d{k.chassis.hd} · {k.chassis.bab === 'full' ? 'full' : k.chassis.bab === 'threeQuarter' ? '¾' : '½'} BAB · good{' '}
                  {k.chassis.goodSaves.map(saveName).join(', ') || 'none'}
                  {k.chassis.prestige ? ' · prestige' : ''}
                  {k.chassisSource === 'sheet' ? ' (set on sheet)' : ''}
                </span>
              ) : (
                <span className="warn-text small-text">progression unknown, set it in Settings</span>
              )}
            </li>
          ))}
        </ul>
        {stats.armor.worn.length > 0 && <p className="small-text muted">Wearing: {stats.armor.worn.join(', ')}</p>}
      </details>

      {manage && <AbilityAdjustments character={c} />}
    </div>
  );
}

/** Wielded weapons from the active loadout, with attack and damage rolls. */
function Attacks({ character: c, stats }: { character: Character; stats: CharacterStats }) {
  if (stats.attacks.length === 0) return <p className="muted small-text">No weapon in hand: wield one in the Inventory tab for attack rolls.</p>;
  const label = (a: CharacterStats['attacks'][number]) => `${a.name}${a.mode !== 'melee' ? ` (${a.mode})` : ''}`;
  const dmg = (a: CharacterStats['attacks'][number]) => `${a.dice}${a.damage.total ? signed(a.damage.total) : ''}`;
  return (
    <section className="sheet-attacks">
      <h3>Attacks</h3>
      <ul>
        {stats.attacks.map((a) => {
          const fullDiffers = a.fullAttack.length > 1 && a.fullAttack[0] !== a.attack.total;
          const fullSuffix =
            a.fullAttack.length > 1
              ? fullDiffers
                ? ` · full ${a.fullAttack.map(signed).join('/')}`
                : ` (${a.fullAttack.slice(1).map(signed).join('/')})`
              : '';
          const attackTitle = `Attack: ${describeLine(a.attack)}${fullDiffers ? `. Full attack: ${a.fullAttack.map(signed).join('/')}` : ''}. Click to roll.`;
          return (
            <li key={`${a.itemId}-${a.mode}`}>
              <span className="sheet-attack-name">{label(a)}</span>
              <button type="button" className="small rollable" title={attackTitle} onClick={() => rollCheck(c, `${label(a)} attack`, a.attack.total)}>
                {signed(a.attack.total)}
                {fullSuffix}
              </button>
              <button
                type="button"
                className="small"
                title={`Damage: ${a.dice}${a.damage.parts.length ? ` + ${describeLine(a.damage)}` : ''}. Click to roll.`}
                onClick={() => rollToChat(dmg(a), `${c.name}: ${label(a)} damage`.slice(0, 100))}
              >
                {dmg(a)}
              </button>
              <span className="muted small-text">
                {a.crit}
                {a.range ? ` · ${a.range} ft` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {stats.twoWeapon && (
        <p className="small-text muted">
          Two-weapon full attack: {stats.twoWeapon.primaryName} {stats.twoWeapon.primary.map(signed).join('/')}, {stats.twoWeapon.offHandName}{' '}
          {stats.twoWeapon.offHand.map(signed).join('/')}
        </p>
      )}
    </section>
  );
}

function Stat({ label, line, roll, bonus }: { label: string; line: StatLine; roll?: () => void; bonus?: boolean }) {
  const value = bonus ? signed(line.total) : String(line.total);
  const title = `${label}: ${describeLine(line)}${roll ? '. Click to roll.' : ''}`;
  return roll ? (
    <button type="button" className="sheet-stat rollable" title={title} onClick={roll}>
      <span className="sheet-stat-label">{label}</span>
      <span className="sheet-stat-value">{value}</span>
    </button>
  ) : (
    <div className="sheet-stat" title={title}>
      <span className="sheet-stat-label">{label}</span>
      <span className="sheet-stat-value">{value}</span>
    </div>
  );
}

function HpBlock({ character: c, stats, manage }: { character: Character; stats: CharacterStats; manage: boolean }) {
  const tokens = useGame((s) => s.tokens);
  const max = Math.max(1, stats.hp.total);
  const hp = characterHp({ tokens }, c, max);
  const [amount, setAmount] = useState('');

  function apply(sign: 1 | -1) {
    const n = Math.abs(Math.round(Number(amount)));
    if (!n) return;
    const next = applyHpDelta({ value: hp.current, max, temp: hp.temp }, sign * n);
    setHp(c, { current: next.value, temp: next.temp, nonlethal: hp.nonlethal }, max);
    setAmount('');
  }

  const pct = Math.max(0, Math.min(100, (hp.current / max) * 100));
  return (
    <div className="sheet-hp" title={`Max HP: ${describeLine(stats.hp)}`}>
      <div className="sheet-hp-numbers">
        <span className="sheet-hp-current">{hp.current}</span>
        <span className="muted"> / {max} HP</span>
        {hp.temp > 0 && <span className="temp-hp"> +{hp.temp} temp</span>}
        {hp.nonlethal > 0 && <span className="warn-text"> · {hp.nonlethal} nonlethal</span>}
        {hp.fromToken && <span className="muted small-text"> · on token</span>}
      </div>
      <div className="hp-bar-html">
        <div style={{ width: `${pct}%`, background: pct > 50 ? '#40c057' : pct > 25 ? '#fab005' : '#fa5252' }} />
      </div>
      {manage && (
        <div className="field-row hp-quick">
          <input
            type="number"
            min={0}
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply(-1)}
          />
          <button type="button" className="small danger" onClick={() => apply(-1)}>
            Damage
          </button>
          <button type="button" className="small" onClick={() => apply(1)}>
            Heal
          </button>
          <button
            type="button"
            className="small"
            title="Set temporary HP (enter 0 to clear)"
            onClick={() => {
              if (amount.trim() === '') return;
              const n = Math.round(Number(amount));
              if (Number.isFinite(n) && n >= 0) setHp(c, { ...hp, temp: n }, max);
              setAmount('');
            }}
          >
            Temp
          </button>
          <button
            type="button"
            className="small"
            title="Add nonlethal damage (negative to heal)"
            onClick={() => {
              if (amount.trim() === '') return;
              const n = Math.round(Number(amount));
              if (Number.isFinite(n) && n !== 0) setHp(c, { ...hp, nonlethal: Math.max(0, hp.nonlethal + n) }, max);
              setAmount('');
            }}
          >
            NL
          </button>
        </div>
      )}
    </div>
  );
}

function AbilityAdjustments({ character: c }: { character: Character }) {
  const kinds = [
    ['abilityTemp', 'Temp ±', 'Temporary changes to the score (spells, items)'],
    ['abilityDamage', 'Damage', 'Ability damage: lowers the modifier'],
    ['abilityDrain', 'Drain', 'Ability drain: lowers the score'],
  ] as const;
  return (
    <details className="inspector-section">
      <summary>Ability damage &amp; temporary changes</summary>
      <table className="sheet-adjust">
        <thead>
          <tr>
            <th />
            {kinds.map(([, label, title]) => (
              <th key={label} title={title}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAT_KEYS.map((k) => (
            <tr key={k}>
              <td>{k}</td>
              {kinds.map(([field]) => (
                <td key={field}>
                  <AdjustInput
                    value={c.runtime[field][k] ?? 0}
                    min={field === 'abilityTemp' ? -50 : 0}
                    max={50}
                    onCommit={(v) => {
                      const next = { ...c.runtime[field] };
                      if (v) next[k] = v;
                      else delete next[k];
                      updateRuntime(c, { [field]: next });
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function AdjustInput({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    let n = Math.round(Number(draft) || 0);
    if (!Number.isFinite(n)) n = value;
    n = Math.max(min, Math.min(max, n));
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}
