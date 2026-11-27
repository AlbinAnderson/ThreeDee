/**
 * Abilities (Epic 6): resource pools with pips and Rest, and a categorized
 * browser of feats, traits, class features, racial traits and proficiencies.
 */
import { useMemo, useState } from 'react';
import { Moon, X } from 'lucide-react';
import {
  ABILITY_CATEGORIES,
  canManageCharacter,
  characterAbilities,
  characterPools,
  characterSheetActions,
  chatActions,
  MAX_CUSTOM_POOLS,
  newId,
  pf1eTurnActions,
  type AbilityEntry,
  type Character,
  type CustomPool,
  type ResourcePool,
} from '@vtt/shared';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { currentWhisper } from '../state/uiStore';
import { useCharactersUi } from './store';

const NATURE_LABEL: Record<string, [string, string]> = {
  NORMAL: ['chosen', 'Chosen when building the character'],
  AUTOMATIC: ['granted', 'Granted automatically by class or race'],
  VIRTUAL: ['virtual', 'Granted without needing its prerequisites'],
};

export function AbilitiesTab({ character: c }: { character: Character }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  return (
    <div className="abilities">
      <Resources character={c} manage={manage} />
      <AbilityBrowser character={c} />
    </div>
  );
}

// ------------------------------------------------------------------ resources

function Resources({ character: c, manage }: { character: Character; manage: boolean }) {
  const pools = useMemo(() => characterPools(c), [c]);
  const adjust = (pool: ResourcePool, delta: number) => dispatch(pf1eTurnActions.adjustUse.create({ characterId: c.id, key: pool.key, delta }));
  return (
    <section>
      <div className="section-header">
        <h3>Resources</h3>
        {manage && pools.length > 0 && (
          <button
            type="button"
            className="small"
            title="Restore every pool (after 8 hours of rest)"
            onClick={async () => {
              if (await confirmDialog({ title: 'Rest 8 hours?', message: 'Restore every spell slot, prepared spell, and daily resource pool?', confirmLabel: 'Rest' })) {
                dispatch(pf1eTurnActions.resetUses.create({ characterId: c.id }));
              }
            }}
          >
            <Moon size={12} /> Rest (8 hr)
          </button>
        )}
      </div>
      {pools.length === 0 && <p className="muted small-text">No tracked resources. Add one below for ki, homebrew pools, etc.</p>}
      <ul className="pool-list">
        {pools.map((p) => {
          const left = Math.max(0, p.max - p.used);
          return (
            <li key={p.key}>
              <div className="pool-head">
                <span className="flex1" title={p.className ? `${p.className} class resource` : 'Custom pool'}>
                  {p.name}
                </span>
                <span className={`${left === 0 ? 'warn-text ' : ''}small-text tnum`}>
                  {left}/{p.max} {p.unit}
                </span>
                {manage && (
                  <>
                    <button type="button" className="small" aria-label={`Use 1 ${p.name}`} disabled={left === 0} onClick={() => adjust(p, 1)}>
                      −
                    </button>
                    <button type="button" className="small" aria-label={`Restore 1 ${p.name}`} disabled={p.used === 0} onClick={() => adjust(p, -1)}>
                      +
                    </button>
                  </>
                )}
                {manage && p.custom && (
                  <button
                    type="button"
                    className="small icon-button"
                    aria-label={`Remove ${p.name}`}
                    onClick={async () => {
                      if (await confirmDialog({ title: `Remove ${p.name}?`, message: `Delete the custom "${p.name}" resource pool?`, confirmLabel: 'Remove', danger: true })) {
                        dispatch(characterSheetActions.updateSheet.create({ id: c.id, changes: { customPools: c.sheet.customPools.filter((x) => `custom.${x.id}` !== p.key) } }));
                      }
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {p.max <= 30 ? (
                <div className="pips" aria-hidden>
                  {Array.from({ length: p.max }, (_, i) => (
                    <span key={i} className={`pip-dot${i < left ? '' : ' spent'}`} />
                  ))}
                </div>
              ) : (
                <span className="resource-bar">
                  <span style={{ width: `${p.max ? (left / p.max) * 100 : 0}%` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {manage && c.sheet.customPools.length < MAX_CUSTOM_POOLS && <AddPool character={c} />}
    </section>
  );
}

function AddPool({ character: c }: { character: Character }) {
  const [name, setName] = useState('');
  const [maxText, setMaxText] = useState('3');
  const [unit, setUnit] = useState<CustomPool['unit']>('uses');
  const add = () => {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    if (c.sheet.customPools.some((p) => p.name.toLowerCase() === n.toLowerCase())) return notify(`${n} is already tracked`);
    const parsed = Number(maxText);
    const max = Number.isFinite(parsed) ? Math.max(0, Math.min(999, Math.round(parsed))) : 0;
    const pool: CustomPool = { id: newId(), name: n, max, unit };
    if (dispatch(characterSheetActions.updateSheet.create({ id: c.id, changes: { customPools: [...c.sheet.customPools, pool] } }))) setName('');
  };
  return (
    <div className="pool-add">
      <input placeholder="New pool (e.g. Ki)" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      <input type="number" min={0} max={999} value={maxText} aria-label="Maximum" onChange={(e) => setMaxText(e.target.value)} />
      <select value={unit} onChange={(e) => setUnit(e.target.value as CustomPool['unit'])} aria-label="Unit">
        <option value="uses">uses</option>
        <option value="rounds">rounds</option>
        <option value="points">points</option>
        <option value="minutes">minutes</option>
      </select>
      <button type="button" onClick={add} disabled={!name.trim()}>
        + Add
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ browser

function AbilityBrowser({ character: c }: { character: Character }) {
  const all = useMemo(() => characterAbilities(c), [c]);
  const category = useCharactersUi((s) => s.abilitiesCategory);
  const query = useCharactersUi((s) => s.abilitiesQuery);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (a) =>
      (category === 'all' || a.category === category) &&
      (!q || [a.name, a.group, a.description ?? '', ...a.appliedTo].some((f) => f.toLowerCase().includes(q))),
  );
  const counts = useMemo(() => Object.fromEntries(ABILITY_CATEGORIES.map((k) => [k.id, all.filter((a) => a.category === k.id).length])), [all]);

  return (
    <section>
      <div className="section-header">
        <h3>Feats, traits &amp; features</h3>
      </div>
      <input
        className="actions-search"
        placeholder="Search abilities…"
        value={query}
        onChange={(e) => useCharactersUi.setState({ abilitiesQuery: e.target.value })}
      />
      <div className="ability-filters" role="group" aria-label="Category">
        <button type="button" className={`small${category === 'all' ? ' active' : ''}`} onClick={() => useCharactersUi.setState({ abilitiesCategory: 'all' })}>
          All {all.length}
        </button>
        {ABILITY_CATEGORIES.filter((k) => counts[k.id]).map((k) => (
          <button
            key={k.id}
            type="button"
            className={`small${category === k.id ? ' active' : ''}`}
            onClick={() => useCharactersUi.setState({ abilitiesCategory: k.id })}
          >
            {k.label} {counts[k.id]}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="muted">Nothing matches.</p>}
      {ABILITY_CATEGORIES.filter((k) => shown.some((a) => a.category === k.id)).map((k) => (
        <div key={k.id} className="ability-group">
          <div className="field-label">{k.label}</div>
          <ul className="ability-list">
            {shown
              .filter((a) => a.category === k.id)
              .map((a) => (
                <AbilityRow key={a.id} character={c} entry={a} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function AbilityRow({ character: c, entry: a, open, onToggle }: { character: Character; entry: AbilityEntry; open: boolean; onToggle: () => void }) {
  const nature = a.nature ? NATURE_LABEL[a.nature] : undefined;
  const post = () =>
    dispatch(
      chatActions.card.create({
        id: newId(),
        card: {
          title: `${c.name}: ${a.name}${a.appliedTo.length ? ` (${a.appliedTo.join(', ')})` : ''}`.slice(0, 120),
          subtitle: a.group.slice(0, 120),
          text: (a.description ?? '').slice(0, 2000) || undefined,
        },
        whisper: currentWhisper(),
      }),
    );
  return (
    <li className={open ? 'open' : ''}>
      <button type="button" className="ability-row" aria-expanded={open} onClick={onToggle}>
        <span className="ability-name">
          {a.name}
          {a.appliedTo.length > 0 && <span className="muted"> ({a.appliedTo.join(', ')})</span>}
        </span>
        <span className="muted small-text ability-group-name">{a.group}</span>
        {nature && (
          <span className="badge subtle" title={nature[1]}>
            {nature[0]}
          </span>
        )}
        {a.source === 'rules' && (
          <span className="badge subtle" title="From the VTT's rules tables, not the .pcg file">
            rules
          </span>
        )}
      </button>
      {open && (
        <div className="ability-detail">
          <div className="identified-text">{a.description || <span className="muted">No description in the file.</span>}</div>
          <button type="button" className="small" onClick={post} title="Post this to chat (uses your chat mode)">
            Post to chat
          </button>
        </div>
      )}
    </li>
  );
}
