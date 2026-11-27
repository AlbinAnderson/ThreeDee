/** Campaign / Pathfinder Society chronicle entries: XP, gold and fame per adventure. */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { characterBioActions, MAX_CHRONICLES, newId, type Character, type ChronicleEntry } from '@vtt/shared';
import { NumberField, TextAreaField, TextField } from '../components/fields';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { notify } from '../state/notifications';

const fmtGold = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} gp`;

export function ChronicleLog({ character: c, manage }: { character: Character; manage: boolean }) {
  const list = c.bio.chronicles;
  const totals = list.reduce((t, e) => ({ xp: t.xp + e.xp, gold: t.gold + e.gold, fame: t.fame + e.fame }), { xp: 0, gold: 0, fame: 0 });
  const [openId, setOpenId] = useState<string | null>(null);

  function add() {
    if (list.length >= MAX_CHRONICLES) return notify(`At most ${MAX_CHRONICLES} chronicle entries`);
    const entry: ChronicleEntry = {
      id: newId(),
      campaign: list[list.length - 1]?.campaign ?? '',
      scenario: 'New adventure',
      date: new Date().toISOString().slice(0, 10),
      gm: '',
      party: '',
      xp: 0,
      gold: 0,
      fame: 0,
      notes: '',
    };
    if (dispatch(characterBioActions.addChronicle.create({ id: c.id, entry }))) setOpenId(entry.id);
  }

  return (
    <section className="bio-section">
      <div className="section-header">
        <h3>Chronicle</h3>
        {manage && (
          <button type="button" className="small gold" onClick={add}>
            <Plus size={12} /> Entry
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="muted small-text">No chronicle entries. Log adventures, XP, gold and fame here.</p>
      ) : (
        <>
          <ul className="chronicle-list">
            {list.map((e) => (
              <ChronicleRow key={e.id} character={c} entry={e} manage={manage} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} />
            ))}
          </ul>
          <div className="muted small-text tnum chronicle-totals">
            Total: {totals.xp} XP · {fmtGold(totals.gold)}
            {totals.fame ? ` · ${totals.fame} fame` : ''}
          </div>
        </>
      )}
    </section>
  );
}

function ChronicleRow({ character: c, entry: e, manage, open, onToggle }: { character: Character; entry: ChronicleEntry; manage: boolean; open: boolean; onToggle: () => void }) {
  const update = (changes: Partial<Omit<ChronicleEntry, 'id'>>) => dispatch(characterBioActions.updateChronicle.create({ id: c.id, entryId: e.id, changes }));
  const text = (label: string, key: 'campaign' | 'scenario' | 'date' | 'gm' | 'party', max: number) => (
    <TextField label={label} value={e[key]} disabled={!manage} onCommit={(v) => update({ [key]: v.trim().slice(0, max) })} />
  );
  return (
    <li className={open ? 'open' : undefined}>
      <button type="button" className="chronicle-head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="chronicle-name">{e.scenario || e.campaign || 'Untitled'}</span>
        <span className="muted small-text tnum">
          {[e.date, e.xp ? `${e.xp} XP` : null, e.gold ? fmtGold(e.gold) : null].filter(Boolean).join(' · ')}
        </span>
      </button>
      {open && (
        <div className="chronicle-body">
          <div className="bio-grid">
            {text('Adventure / scenario', 'scenario', 120)}
            {text('Campaign', 'campaign', 120)}
            {text('Date', 'date', 40)}
            {text('GM', 'gm', 80)}
            <NumberField label="XP" value={e.xp} min={0} max={10_000_000} step={1} disabled={!manage} onCommit={(xp) => update({ xp: Math.round(xp) })} />
            <NumberField label="Gold (gp)" value={e.gold} min={-1e9} max={1e9} disabled={!manage} onCommit={(gold) => update({ gold })} />
            <NumberField label="Fame" value={e.fame} min={-100000} max={100000} step={1} disabled={!manage} onCommit={(fame) => update({ fame: Math.round(fame) })} />
            {text('Party', 'party', 200)}
          </div>
          <TextAreaField label="Notes" value={e.notes} rows={3} disabled={!manage} onCommit={(notes) => update({ notes: notes.slice(0, 4000) })} />
          {manage && (
            <button
              type="button"
              className="small danger"
              onClick={async () => {
                if (await confirmDialog({ title: 'Delete chronicle entry?', message: `“${e.scenario || 'Untitled'}” will be removed.`, confirmLabel: 'Delete', danger: true })) {
                  dispatch(characterBioActions.deleteChronicle.create({ id: c.id, entryId: e.id }));
                }
              }}
            >
              <Trash2 size={12} /> Delete entry
            </button>
          )}
        </div>
      )}
    </li>
  );
}
