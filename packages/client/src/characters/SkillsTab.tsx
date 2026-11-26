/**
 * Skills manager (Epic 5): every PF1e skill with ranks, class-skill status,
 * breakdown tooltips and one-click rolls (chat mode, GM-only, Take 10/20),
 * plus situational modifiers and sheet overrides.
 */
import { useMemo, useState } from 'react';
import {
  canManageCharacter,
  computeCharacterStats,
  computeSkills,
  describeLine,
  newId,
  pf1eTurnActions,
  signed,
  SKILL_FAMILIES,
  skillRollExpression,
  situationalFor,
  type Character,
  type CharacterStats,
  type ChatWhisper,
  type SkillOverride,
  type SkillRow,
} from '@vtt/shared';
import { NumberField, OptionalNumberField, SelectField } from '../components/fields';
import { rollToChat } from '../panels/ChatPanel';
import { dispatch } from '../state/dispatch';
import { useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { updateSheet } from './characterActions';

type Filter = 'all' | 'trained' | 'usable' | 'favorites';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['trained', 'Trained'],
  ['usable', 'Usable'],
  ['favorites', '★'],
];
const GM_ONLY: ChatWhisper = { mode: 'gm', to: [] };
const DEFAULT_OVERRIDE: SkillOverride = { ranks: null, misc: 0, classSkill: null, favorite: false, custom: false };

/** Change one skill's override; entries back at their defaults are dropped. */
function setOverride(c: Character, name: string, patch: Partial<SkillOverride>) {
  const next = { ...c.sheet.skills };
  const merged = { ...DEFAULT_OVERRIDE, ...next[name], ...patch };
  const isDefault = merged.ranks === null && merged.misc === 0 && merged.classSkill === null && !merged.favorite && !merged.custom;
  if (isDefault) delete next[name];
  else next[name] = merged;
  updateSheet(c, { skills: next });
}

function roll(c: Character, row: SkillRow, opts: { take?: 10 | 20; whisper?: ChatWhisper; extras?: (number | string)[]; labelExtra?: string } = {}) {
  const expr = skillRollExpression(row.total.total, opts.extras ?? [], opts.take);
  const label = `${c.name}: ${row.name}${opts.take ? ` (Take ${opts.take})` : ''}${opts.labelExtra ? ` ${opts.labelExtra}` : ''}`.slice(0, 100);
  if (!row.usable) notify(`${row.name} is trained-only: without ranks you can't attempt it`);
  return rollToChat(expr, label, opts.whisper);
}

export function SkillsTab({ character: c }: { character: Character }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const stats = useMemo(() => computeCharacterStats(c), [c]);
  const summary = useMemo(() => computeSkills(c, stats), [c, stats]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openName, setOpenName] = useState<string | null>(null);

  const rows = summary.rows.filter((r) => {
    if (query && !r.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === 'trained') return r.ranks > 0;
    if (filter === 'usable') return r.usable;
    if (filter === 'favorites') return r.favorite;
    return true;
  });

  return (
    <div className="skills">
      <div className="muted small-text">
        {summary.totalRanks} ranks spent · max {summary.maxRanks} per skill
        {stats.armor.acp ? ` · armor check penalty ${stats.armor.acp} on Str/Dex skills` : ''}
      </div>
      {summary.warnings.length > 0 && (
        <div className="sheet-warnings">
          {summary.warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}
      <div className="loot-toolbar">
        <input placeholder="Search skills…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="segmented" role="group" aria-label="Filter skills">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'active' : ''} onClick={() => setFilter(id)} title={id === 'favorites' ? 'Favorites' : undefined}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 && <p className="muted">No skills match.</p>}
      <ul className="skill-list">
        {rows.map((row) => (
          <li key={row.name} className={`${openName === row.name ? 'open' : ''}${row.usable ? '' : ' unusable'}`}>
            <SkillLine character={c} row={row} manage={manage} open={openName === row.name} onToggle={() => setOpenName(openName === row.name ? null : row.name)} />
            {openName === row.name && <SkillDetail character={c} stats={stats} row={row} manage={manage} />}
          </li>
        ))}
      </ul>
      {manage && <AddSubSkill character={c} existing={summary.rows.map((r) => r.name)} />}
      <p className="muted small-text">
        Click a total to roll (uses your chat mode); 🔒 rolls for the GM only. Open a skill (⋯) for situational bonuses and to adjust ranks or misc.
      </p>
    </div>
  );
}

function SkillLine({ character: c, row, manage, open, onToggle }: { character: Character; row: SkillRow; manage: boolean; open: boolean; onToggle: () => void }) {
  const title = `${row.name}: ${describeLine(row.total)}${row.trainedOnly ? ' · trained only' : ''}${row.usable ? '' : ' (needs ranks)'}`;
  return (
    <div className="skill-row">
      <button
        type="button"
        className={`skill-fav${row.favorite ? ' on' : ''}`}
        aria-label={`${row.favorite ? 'Unfavorite' : 'Favorite'} ${row.name}`}
        aria-pressed={row.favorite}
        disabled={!manage}
        onClick={() => setOverride(c, row.name, { favorite: !row.favorite })}
      >
        {row.favorite ? '★' : '☆'}
      </button>
      <span className="skill-name" title={title}>
        {row.name}
        {row.classSkill && (
          <span className="badge" title="Class skill: +3 with at least 1 rank">
            C
          </span>
        )}
        {row.trainedOnly && <span className="muted small-text" title="Trained only"> ᵀ</span>}
      </span>
      <span className="muted small-text skill-ability">{row.ability ?? '—'}</span>
      <span className="muted small-text skill-ranks" title="Ranks">
        {row.ranks}
      </span>
      <button type="button" className="small rollable skill-total" title={`${title}. Click to roll.`} onClick={() => roll(c, row)} aria-label={`Roll ${row.name}`}>
        {signed(row.total.total)}
      </button>
      <button type="button" className="small" title="Roll for the GM only" aria-label={`Roll ${row.name} for the GM only`} onClick={() => roll(c, row, { whisper: GM_ONLY })}>
        🔒
      </button>
      <button type="button" className="small" aria-expanded={open} aria-label={`More for ${row.name}`} onClick={onToggle}>
        ⋯
      </button>
    </div>
  );
}

function SkillDetail({ character: c, stats, row, manage }: { character: Character; stats: CharacterStats; row: SkillRow; manage: boolean }) {
  const situational = useMemo(() => situationalFor(c, stats, row), [c, stats, row]);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [extra, setExtra] = useState(0);
  const chosen = situational.filter((x) => on[x.id]);
  const extras = [...chosen.map((x) => x.bonus), ...(extra ? [extra] : [])];
  const labelExtra = chosen.length ? `+ ${chosen.map((x) => x.label.replace(/\s*\(.*\)$/, '')).join(', ')}` : undefined;

  const go = (opts: { take?: 10 | 20; whisper?: ChatWhisper }) => {
    for (const x of chosen) {
      if (!x.spendActionId) continue;
      // Spend the resource (and announce it); stop if there's none left.
      if (!dispatch(pf1eTurnActions.act.create({ actionId: x.spendActionId, characterId: c.id, chatId: newId() }))) return;
    }
    roll(c, row, { ...opts, extras, labelExtra });
  };

  return (
    <div className="skill-detail">
      <div className="small-text">{describeLine(row.total) || 'No modifiers'}</div>
      {situational.length > 0 && (
        <div className="skill-situational">
          {situational.map((x) => (
            <label key={x.id} className="checkbox-row">
              <input type="checkbox" checked={!!on[x.id]} onChange={(e) => setOn({ ...on, [x.id]: e.target.checked })} />
              {x.label} ({typeof x.bonus === 'number' ? signed(x.bonus) : `+${x.bonus}`})
            </label>
          ))}
        </div>
      )}
      <div className="field-row">
        <NumberField label="Situational ±" value={extra} min={-50} max={50} step={1} onCommit={(v) => setExtra(Math.round(v))} />
      </div>
      <div className="button-row">
        <button type="button" className="primary" onClick={() => go({})}>
          Roll {signed(row.total.total + extras.filter((e): e is number => typeof e === 'number').reduce((a, b) => a + b, 0))}
          {extras.some((e) => typeof e === 'string') ? '+1d6' : ''}
        </button>
        <button type="button" onClick={() => go({ take: 10 })} title="Take 10: when not threatened or distracted">
          Take 10
        </button>
        <button type="button" onClick={() => go({ take: 20 })} title="Take 20: with time and no penalty for failure (takes 20× as long)">
          Take 20
        </button>
        <button type="button" onClick={() => go({ whisper: GM_ONLY })} title="Roll for the GM only">
          🔒 GM
        </button>
      </div>

      {manage && (
        <div className="field-row">
          <OptionalNumberField
            label="Ranks"
            value={row.override?.ranks ?? null}
            min={0}
            max={100}
            placeholder={`file: ${row.fileRanks}`}
            onCommit={(ranks) => setOverride(c, row.name, { ranks })}
          />
          <NumberField label="Misc" value={row.override?.misc ?? 0} min={-50} max={50} step={1} onCommit={(misc) => setOverride(c, row.name, { misc: Math.round(misc) })} />
          <SelectField
            label="Class skill"
            value={row.override?.classSkill === null || row.override?.classSkill === undefined ? 'file' : row.override.classSkill ? 'yes' : 'no'}
            options={[
              { value: 'file', label: 'From file' },
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            onCommit={(v) => setOverride(c, row.name, { classSkill: v === 'file' ? null : v === 'yes' })}
          />
        </div>
      )}
      {manage && row.custom && (
        <button
          type="button"
          className="small danger"
          onClick={() => {
            const next = { ...c.sheet.skills };
            delete next[row.name];
            updateSheet(c, { skills: next });
          }}
        >
          Remove {row.name}
        </button>
      )}
    </div>
  );
}

function AddSubSkill({ character: c, existing }: { character: Character; existing: string[] }) {
  const [family, setFamily] = useState('Profession');
  const [sub, setSub] = useState('');
  const add = () => {
    const s = sub.trim().replace(/[()]/g, '');
    if (!s) return;
    const name = `${family} (${s.charAt(0).toUpperCase()}${s.slice(1)})`.slice(0, 80);
    if (existing.some((e) => e.toLowerCase() === name.toLowerCase())) return notify(`${name} is already listed`);
    setOverride(c, name, { custom: true });
    setSub('');
  };
  return (
    <div className="skill-add">
      <select value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Skill">
        {SKILL_FAMILIES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <input placeholder="e.g. Sailor, Weapons, Sing" value={sub} maxLength={60} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      <button type="button" onClick={add} disabled={!sub.trim()}>
        + Add
      </button>
    </div>
  );
}
