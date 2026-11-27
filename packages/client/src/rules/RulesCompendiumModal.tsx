/**
 * Rules & Compendium modal (Epic 11, #52, #53, #58, #59):
 *  - Search across loaded PCGen rules pack + custom room rules
 *  - GM Allowed Sources picker (+ "Match party .pcg books")
 *  - GM On-demand Archives of Nethys item/spell/feat importer with draft review
 *  - GM Archives of Nethys monster stat block -> GM-only NPC + hidden token
 */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, ExternalLink, Lock, Plus, Search, Skull, Trash2, X } from 'lucide-react';
import {
  monsterToCharacter,
  monsterToken,
  newId,
  partySourceKeys,
  rulesActions,
  type CustomRule,
  type CustomRuleDraft,
  type CustomRuleKind,
  type MonsterDraft,
  type RulesBook,
  type RulesHit,
  type RulesKind,
  type RulesStatus,
} from '@vtt/shared';
import { request } from '../net/rpc';
import { confirmDialog, useDialogStore } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useCurrentScene, useGame, useIsGm, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { openRulesCard, useRulesUi, type CompendiumTab } from './store';

export function RulesCompendiumModal() {
  const open = useRulesUi((s) => s.compendiumOpen);
  const tab = useRulesUi((s) => s.compendiumTab);
  const close = useRulesUi((s) => s.closeCompendium);
  const gm = useIsGm();
  const [status, setStatus] = useState<RulesStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    request('rules.status', {})
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Capture phase so the compendium (rendered above the sheet pop-out, handouts, import and
    // shortcuts) consumes Escape before their own listeners close the layer underneath.
    const onKey = (e: KeyboardEvent) => {
      // A rules card or confirm dialog on top closes first.
      if (e.key !== 'Escape' || useRulesUi.getState().card || useDialogStore.getState().current) return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  if (!open) return null;

  const activeTab: CompendiumTab = gm ? tab : 'search';
  const totalRecords = status ? Object.values(status.counts).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-card rules-modal" role="dialog" aria-modal="true" aria-label="PF1e Rules & Compendium">
        <div className="section-header">
          <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={16} /> PF1e Rules &amp; Compendium
          </h3>
          <span className="muted small-text">
            {status?.loaded ? `${totalRecords.toLocaleString('en-US')} records · ${status.books} books` : 'No rules pack built yet'}
          </span>
          <button type="button" className="icon-button" aria-label="Close compendium" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="rules-tabs" role="tablist">
          <button type="button" className={activeTab === 'search' ? 'active' : ''} onClick={() => useRulesUi.setState({ compendiumTab: 'search' })}>
            <Search size={12} /> Search
          </button>
          {gm && (
            <>
              <button type="button" className={activeTab === 'sources' ? 'active' : ''} onClick={() => useRulesUi.setState({ compendiumTab: 'sources' })}>
                <BookOpen size={12} /> Allowed Books
              </button>
              <button type="button" className={activeTab === 'aon' ? 'active' : ''} onClick={() => useRulesUi.setState({ compendiumTab: 'aon' })}>
                <Download size={12} /> AoN Import
              </button>
              <button type="button" className={activeTab === 'monster' ? 'active' : ''} onClick={() => useRulesUi.setState({ compendiumTab: 'monster' })}>
                <Skull size={12} /> Monster NPC
              </button>
            </>
          )}
        </div>

        <div className="rules-modal-body">
          {activeTab === 'search' && <SearchTab gm={gm} loaded={status?.loaded ?? false} />}
          {activeTab === 'sources' && gm && <SourcesTab />}
          {activeTab === 'aon' && gm && <AonImportTab />}
          {activeTab === 'monster' && gm && <MonsterImportTab onImported={close} />}
        </div>
      </div>
    </div>
  );
}

const SEARCH_CATEGORIES: [RulesKind | 'all', string][] = [
  ['all', 'All'],
  ['equipment', 'Equipment'],
  ['spell', 'Spells'],
  ['feat', 'Feats'],
  ['ability', 'Abilities'],
  ['class', 'Classes'],
  ['race', 'Races'],
  ['deity', 'Deities'],
  ['domain', 'Domains'],
];

const KIND_BADGE: Record<RulesKind, string> = {
  equipment: 'Item',
  equipmod: 'Mod',
  spell: 'Spell',
  feat: 'Feat',
  ability: 'Ability',
  deity: 'Deity',
  domain: 'Domain',
  class: 'Class',
  race: 'Race',
};

function SearchTab({ gm, loaded }: { gm: boolean; loaded: boolean }) {
  const [kind, setKind] = useState<RulesKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [allSources, setAllSources] = useState(false);
  const [hits, setHits] = useState<RulesHit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setBusy(true);
      request('rules.search', {
        ...(kind === 'all' ? {} : { kind }),
        q,
        limit: 40,
        ...(gm && allSources ? { allSources: true } : {}),
      })
        .then((res) => alive && setHits(res))
        .catch(() => alive && setHits([]))
        .finally(() => alive && setBusy(false));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [kind, q, gm, allSources]);

  return (
    <div className="rules-pane">
      {!loaded && (
        <p className="muted small-text">
          Build the local PCGen rules pack on the server with <code>npm run vtt -- rules build data/pcgen/data/pathfinder</code> to enable full offline search. Custom room rules still appear below.
        </p>
      )}
      <div className="search-input-wrap">
        <Search size={14} className="search-icon" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search spells, feats, weapons, magic items, deities…"
          aria-label="Search rules"
          autoFocus
        />
        {q && (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQ('')}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className="rules-category-pills" role="group" aria-label="Rule category">
        {SEARCH_CATEGORIES.map(([id, label]) => (
          <button key={id} type="button" className={kind === id ? 'active' : ''} aria-pressed={kind === id} onClick={() => setKind(id)}>
            {label}
          </button>
        ))}
      </div>
      {gm && (
        <label className="checkbox-row small-text">
          <input type="checkbox" checked={allSources} onChange={(e) => setAllSources(e.target.checked)} /> Include disallowed books (GM preview)
        </label>
      )}
      {busy && <p className="muted small-text">Searching…</p>}
      <ul className="rules-hit-list">
        {hits.map((h) => (
          <li key={`${h.kind}:${h.key}`}>
            <button
              type="button"
              className="rules-hit-btn"
              onClick={() => openRulesCard({ kind: h.kind, key: h.customId ? undefined : h.key, customId: h.customId, name: h.name })}
            >
              <span className="rules-hit-main">
                <strong>{h.name}</strong>
                {h.summary && <span className="muted small-text">{h.summary}</span>}
              </span>
              <span className="rules-hit-badges">
                {kind === 'all' && <span className="badge">{KIND_BADGE[h.kind]}</span>}
                <span className="badge subtle">{h.source.short}</span>
              </span>
            </button>
          </li>
        ))}
        {!busy && hits.length === 0 && <li className="muted small-text" style={{ padding: '12px 4px' }}>No matches{q ? ` for “${q}”` : ''}.</li>}
      </ul>
    </div>
  );
}

function SourcesTab() {
  const allowed = useGame((s) => s.rules.allowedSources);
  const characters = useGame((s) => s.characters);
  const [books, setBooks] = useState<RulesBook[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    request('rules.books', {})
      .then(setBooks)
      .catch(() => setBooks([]));
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? books.filter((b) => `${b.name} ${b.key} ${b.publisher}`.toLowerCase().includes(q)) : books;
  }, [books, filter]);

  const setAllowed = (next: string[] | null) => dispatch(rulesActions.setAllowedSources.create({ allowedSources: next }));
  const toggleBook = (key: string) => {
    const current = new Set(allowed ?? books.map((b) => b.key));
    if (current.has(key)) current.delete(key);
    else current.add(key);
    setAllowed([...current].sort());
  };

  return (
    <div className="rules-pane">
      <div className="button-row">
        <button type="button" className={`small${allowed === null ? ' primary' : ''}`} onClick={() => setAllowed(null)}>
          Allow all books
        </button>
        <button
          type="button"
          className="small gold"
          disabled={books.length === 0}
          onClick={() => {
            const keys = partySourceKeys(Object.values(characters), books);
            if (!keys.length) return notify('No party .pcg books matched the rules pack');
            setAllowed(keys);
            notify(`Allowed ${keys.length} book(s) from party .pcg files`, 'info');
          }}
        >
          Match party .pcg books
        </button>
        <span className="muted small-text">{allowed === null ? 'All books allowed' : `${allowed.length} book(s) allowed`}</span>
      </div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter books…" aria-label="Filter books" />
      {books.length === 0 && <p className="muted small-text">No rules pack loaded on the server.</p>}
      <ul className="rules-books-list">
        {filtered.map((b) => {
          const checked = allowed === null || allowed.includes(b.key);
          return (
            <li key={b.key}>
              <label className="checkbox-row small-text">
                <input type="checkbox" checked={checked} onChange={() => toggleBook(b.key)} />
                <span className="flex1">
                  <strong>{b.name}</strong> <span className="muted">({b.publisher} · {b.records} entries)</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AonImportTab() {
  const customRules = useGame((s) => s.customRules);
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<'spell' | 'feat' | 'wondrous' | 'weapon' | 'armor' | 'equipment' | 'ring' | 'rod' | 'staff'>('wondrous');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<(CustomRuleDraft & { gmOnly: boolean }) | null>(null);
  const [costDraft, setCostDraft] = useState('');
  const [weightDraft, setWeightDraft] = useState('');
  const [clDraft, setClDraft] = useState('');

  async function doFetch() {
    if (!url.trim() && !name.trim()) return notify('Enter an AoN URL or an item/spell/feat name');
    setBusy(true);
    try {
      const res = await request('rules.fetchAon', url.trim() ? { url: url.trim() } : { kind, name: name.trim() });
      if (!res.draft || res.draft.kind !== 'rule') return notify('That page looks like a monster stat block — use the Monster NPC tab');
      const r = res.draft.rule;
      setDraft({ ...r, gmOnly: false });
      setCostDraft(r.cost !== null ? String(r.cost) : '');
      setWeightDraft(r.weight !== null ? String(r.weight) : '');
      setClDraft(r.cl !== null ? String(r.cl) : '');
      notify(res.cached ? 'Loaded from server AoN cache' : 'Fetched from Archives of Nethys', 'info');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!draft) return;
    const parseOpt = (s: string) => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const rule: CustomRule = {
      id: newId(),
      kind: draft.kind as CustomRuleKind,
      name: draft.name.trim().slice(0, 120) || 'Unnamed',
      source: draft.source.slice(0, 160),
      aonUrl: draft.aonUrl,
      text: draft.text.slice(0, 8000),
      fields: draft.fields,
      cost: parseOpt(costDraft),
      weight: parseOpt(weightDraft),
      cl: parseOpt(clDraft) !== null ? Math.min(30, Math.floor(parseOpt(clDraft)!)) : null,
      slot: draft.slot,
      weapon: draft.weapon,
      armor: draft.armor,
      gmOnly: draft.gmOnly,
      createdAt: Date.now(),
    };
    if (dispatch(rulesActions.saveCustom.create({ rule }))) {
      notify(`Saved "${rule.name}" to room rules`, 'info');
      setDraft(null);
    }
  }

  const saved = Object.values(customRules).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="rules-pane">
      <p className="muted small-text">
        Fetches one allowlisted <code>aonprd.com</code> page per click (rate-limited &amp; cached on the server). Review the parsed draft before saving.
      </p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste https://www.aonprd.com/...Display.aspx?ItemName=..." />
      <div className="field-row">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="AoN page type">
          <option value="wondrous">Magic Wondrous</option>
          <option value="weapon">Weapon</option>
          <option value="armor">Armor</option>
          <option value="equipment">Equipment</option>
          <option value="ring">Ring</option>
          <option value="rod">Rod</option>
          <option value="staff">Staff</option>
          <option value="spell">Spell</option>
          <option value="feat">Feat</option>
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="…or look up by exact name" />
        <button type="button" className="small gold" disabled={busy} onClick={() => void doFetch()}>
          {busy ? 'Fetching…' : 'Fetch'}
        </button>
      </div>

      {draft && (
        <div className="rules-draft-box">
          <div className="section-header">
            <strong>Review Draft</strong>
            {draft.aonUrl && (
              <a className="small-text" href={draft.aonUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={11} /> Source
              </a>
            )}
          </div>
          <div className="field-row">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" />
            <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="Book & page" />
          </div>
          {draft.kind === 'equipment' && (
            <div className="field-row">
              <input value={costDraft} onChange={(e) => setCostDraft(e.target.value)} placeholder="Cost (gp)" />
              <input value={weightDraft} onChange={(e) => setWeightDraft(e.target.value)} placeholder="Weight (lb)" />
              <input value={clDraft} onChange={(e) => setClDraft(e.target.value)} placeholder="CL" />
            </div>
          )}
          <textarea rows={4} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <label className="checkbox-row small-text">
            <input type="checkbox" checked={draft.gmOnly} onChange={(e) => setDraft({ ...draft, gmOnly: e.target.checked })} />
            <Lock size={11} /> GM-only (hidden from players)
          </label>
          <div className="button-row">
            <button type="button" className="small primary" onClick={saveDraft}>
              <Plus size={12} /> Save to Room Catalog
            </button>
            <button type="button" className="small" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div>
          <div className="field-label">Saved room rules ({saved.length})</div>
          <ul className="rules-hit-list">
            {saved.map((r) => (
              <li key={r.id} className="rules-saved-row">
                <button type="button" className="rules-hit-btn" onClick={() => openRulesCard({ kind: r.kind, customId: r.id, name: r.name })}>
                  <span>
                    <strong>{r.name}</strong> <span className="muted small-text">({r.kind})</span>
                    {r.gmOnly && <Lock size={11} style={{ marginLeft: 4 }} />}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Delete ${r.name}`}
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete "${r.name}"?`, message: 'Remove this custom rule from the room?', confirmLabel: 'Delete', danger: true })) {
                      dispatch(rulesActions.deleteCustom.create({ id: r.id }));
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MonsterImportTab({ onImported }: { onImported: () => void }) {
  const self = useSelf();
  const scene = useCurrentScene();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [monster, setMonster] = useState<MonsterDraft | null>(null);

  async function doFetch() {
    if (!url.trim() && !name.trim()) return notify('Enter a MonsterDisplay URL or monster name');
    setBusy(true);
    try {
      const res = await request('rules.fetchAon', url.trim() ? { url: url.trim() } : { kind: 'monster', name: name.trim() });
      if (!res.monster) return notify('That page is not a monster stat block');
      setMonster(res.monster);
      notify(res.cached ? 'Loaded monster from cache' : 'Fetched monster stat block', 'info');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function spawn(withToken: boolean) {
    if (!monster) return;
    const charId = newId();
    const tokenId = withToken && scene ? newId() : null;
    const baseChar = monsterToCharacter(monster, { id: charId, now: Date.now(), importedBy: self.id });
    const character = tokenId ? { ...baseChar, tokenId } : baseChar;
    const token =
      tokenId && scene
        ? monsterToken(monster, {
            id: tokenId,
            sceneId: scene.id,
            x: Math.round(scene.width / 2 / scene.grid.size) * scene.grid.size,
            y: Math.round(scene.height / 2 / scene.grid.size) * scene.grid.size,
            unitsPerCell: scene.grid.unitsPerCell,
          })
        : null;
    if (dispatch(rulesActions.spawnMonster.create({ character, token }))) {
      notify(token ? `Imported ${monster.name} (GM-only NPC + hidden token)` : `Imported ${monster.name} (GM-only NPC)`, 'info');
      setMonster(null);
      onImported();
    }
  }

  return (
    <div className="rules-pane">
      <p className="muted small-text">
        Import a PF1e Bestiary stat block from Archives of Nethys as a GM-only NPC (with rollable attacks, saves, skills and an optional hidden map token).
      </p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste https://www.aonprd.com/MonsterDisplay.aspx?ItemName=Goblin" />
      <div className="field-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="…or monster name (e.g. Goblin)" />
        <button type="button" className="small gold" disabled={busy} onClick={() => void doFetch()}>
          {busy ? 'Fetching…' : 'Fetch Monster'}
        </button>
      </div>

      {monster && (
        <div className="rules-draft-box small-text">
          <div className="section-header">
            <strong>
              {monster.name} {monster.cr ? `(CR ${monster.cr})` : ''}
            </strong>
            <span className="muted">
              {monster.alignment} {monster.size} {monster.type}
            </span>
          </div>
          <div>
            <strong>HP</strong> {monster.hp.total} ({monster.hp.hd}) · <strong>AC</strong> {monster.ac.total} (touch {monster.ac.touch}, FF {monster.ac.flatFooted}) ·{' '}
            <strong>Init</strong> {monster.init >= 0 ? `+${monster.init}` : monster.init}
          </div>
          <div>
            <strong>Saves</strong> Fort {monster.saves.fort >= 0 ? `+${monster.saves.fort}` : monster.saves.fort}, Ref{' '}
            {monster.saves.ref >= 0 ? `+${monster.saves.ref}` : monster.saves.ref}, Will {monster.saves.will >= 0 ? `+${monster.saves.will}` : monster.saves.will} ·{' '}
            <strong>BAB</strong> +{monster.bab} · <strong>CMB</strong> +{monster.cmb} · <strong>CMD</strong> {monster.cmd}
          </div>
          {monster.senses.text && (
            <div>
              <strong>Senses:</strong> {monster.senses.text}
            </div>
          )}
          {(monster.melee.length > 0 || monster.ranged.length > 0) && (
            <div>
              <strong>Attacks:</strong> {[...monster.melee, ...monster.ranged].map((a) => `${a.name} (${a.bonuses.map((b) => (b >= 0 ? `+${b}` : b)).join('/')}, ${a.dice})`).join('; ')}
            </div>
          )}
          <div className="button-row" style={{ marginTop: 8 }}>
            <button type="button" className="small primary" disabled={!scene} onClick={() => spawn(true)}>
              <Skull size={12} /> Import NPC + Hidden Token
            </button>
            <button type="button" className="small" onClick={() => spawn(false)}>
              Import NPC Only
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
