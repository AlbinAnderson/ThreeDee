import { useMemo, useState } from 'react';
import { Dices, Package, Sparkles } from 'lucide-react';
import {
  canManageCharacter,
  canSeeCl,
  identifyDc,
  inventoryActions,
  isGm,
  lootActions,
  newId,
  TREASURE_BANDS,
  TREASURE_TYPES,
  type LootItem,
  type TreasureBand,
  type TreasureType,
  type User,
} from '@vtt/shared';
import { CheckboxField, ImageUploadButton, NumberField, OptionalNumberField, SelectField, TextAreaField, TextField } from '../components/fields';
import { uploadAsset } from '../lib/assets';
import { request } from '../net/rpc';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { useSession } from '../state/session';
import { exportLoot, lootExporters, type LootExportFormat } from './exportLoot';

const PARTY = '__party__';
const ALL = '__all__';

export function LootPanel() {
  const loot = useGame((s) => s.loot);
  const users = useGame((s) => s.users);
  const self = useSelf();
  const roomId = useSession((s) => s.connection?.params.roomId ?? 'room');
  const [query, setQuery] = useState('');
  const [holderFilter, setHolderFilter] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showTreasure, setShowTreasure] = useState(false);
  const gm = isGm(self);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(loot)
      .filter((i) => {
        // Moved whole into a character's inventory (kept only for its true properties).
        if (i.stowed) return false;
        if (holderFilter === PARTY && i.holderId) return false;
        if (holderFilter !== ALL && holderFilter !== PARTY && i.holderId !== holderFilter) return false;
        if (!q) return true;
        return [i.name, i.notes, i.value, i.secretNotes].some((f) => f.toLowerCase().includes(q));
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [loot, query, holderFilter]);

  const userList = useMemo(() => Object.values(users).sort((a, b) => a.name.localeCompare(b.name)), [users]);

  function addItem() {
    const id = newId();
    const ok = dispatch(
      lootActions.create.create({
        id,
        item: { name: 'New item', imageUrl: null, quantity: 1, value: '', holderId: null, notes: '' },
      }),
    );
    if (ok) {
      setOpenId(id);
      setQuery('');
      setHolderFilter(ALL);
    }
  }

  function onExport(format: string) {
    if (!(format in lootExporters)) return;
    const all = Object.values(loot)
      .filter((i) => !i.stowed)
      .sort((a, b) => a.createdAt - b.createdAt);
    exportLoot(format as LootExportFormat, all, users, roomId);
  }

  return (
    <div className="panel-scroll loot-panel">
      <div className="loot-toolbar">
        <input placeholder="Search loot…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {gm && (
          <button type="button" className={`small${showTreasure ? ' active' : ' gold'}`} title="GM Treasure Generator" onClick={() => setShowTreasure((v) => !v)}>
            <Sparkles size={12} /> Treasure
          </button>
        )}
        <button type="button" className="primary" onClick={addItem}>
          + Add
        </button>
      </div>
      {gm && showTreasure && <TreasureGenerator onDropped={(id) => { setOpenId(id); setShowTreasure(false); }} />}
      <div className="loot-toolbar">
        <select value={holderFilter} onChange={(e) => setHolderFilter(e.target.value)}>
          <option value={ALL}>Everyone</option>
          <option value={PARTY}>Party stash</option>
          {userList.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => {
            onExport(e.target.value);
            e.target.value = '';
          }}
          disabled={!Object.values(loot).some((i) => !i.stowed)}
          title="Download all loot"
        >
          <option value="">Export…</option>
          {Object.entries(lootExporters).map(([k, ex]) => (
            <option key={k} value={k}>
              {ex.label}
            </option>
          ))}
        </select>
      </div>

      {items.length === 0 && (
        <p className="muted">{Object.values(loot).some((i) => !i.stowed) ? 'Nothing matches.' : 'No loot yet. Add the first find!'}</p>
      )}
      <ul className="loot-list">
        {items.map((item) => (
          <li key={item.id} className={openId === item.id ? 'open' : ''}>
            <LootRow
              item={item}
              holder={item.holderId ? users[item.holderId] : undefined}
              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
            />
            {openId === item.id && <LootEditor item={item} users={userList} self={self} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LootRow({ item, holder, onToggle }: { item: LootItem; holder: User | undefined; onToggle: () => void }) {
  return (
    <button type="button" className="loot-row" onClick={onToggle}>
      {item.imageUrl ? <img className="loot-thumb" src={item.imageUrl} alt="" /> : <span className="loot-thumb empty"><Package size={16} /></span>}
      <span className="loot-main">
        <span className="loot-name">
          {item.name}
          {item.quantity !== 1 && <span className="muted"> ×{item.quantity}</span>}
        </span>
        <span className="loot-sub muted">
          {holder ? holder.name : 'Party'}
          {item.value && ` · ${item.value}`}
        </span>
      </span>
      <span className={`badge ${item.identified ? '' : 'subtle'}`}>{item.identified ? 'ID’d' : 'Unknown'}</span>
    </button>
  );
}

function LootEditor({ item, users, self }: { item: LootItem; users: User[]; self: User }) {
  const gm = isGm(self);
  const update = (changes: Parameters<typeof lootActions.update.create>[0]['changes']) =>
    dispatch(lootActions.update.create({ id: item.id, changes }));
  const canDelete = gm || item.createdBy === self.id;

  return (
    <div className="loot-editor">
      <TextField label="Name" value={item.name} onCommit={(name) => update({ name })} />
      <div className="field-row">
        <NumberField label="Qty" value={item.quantity} min={0} max={1_000_000} step={1} onCommit={(quantity) => update({ quantity: Math.round(quantity) })} />
        <TextField label="Value" value={item.value} placeholder="e.g. 250 gp" onCommit={(value) => update({ value })} />
      </div>
      <SelectField
        label="Carried by"
        value={item.holderId ?? PARTY}
        options={[{ value: PARTY, label: 'Party stash' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
        onCommit={(v) => update({ holderId: v === PARTY ? null : v })}
      />
      <div className="button-row">
        {item.imageUrl && <img className="loot-image" src={item.imageUrl} alt={item.name} />}
        <ImageUploadButton
          label={item.imageUrl ? 'Replace image' : 'Add image'}
          onFile={async (file) => {
            try {
              update({ imageUrl: await uploadAsset(file) });
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        />
        {item.imageUrl && (
          <button type="button" onClick={() => update({ imageUrl: null })}>
            Remove image
          </button>
        )}
      </div>
      <TextAreaField
        label="Party notes (what we think it does)"
        value={item.notes}
        rows={3}
        onCommit={(notes) => update({ notes })}
      />

      {gm ? (
        <div className="gm-box">
          <div className="field-row">
            <TextField
              label="True name (GM)"
              value={item.trueName}
              placeholder="Revealed on identify"
              onCommit={(trueName) => dispatch(lootActions.setSecret.create({ id: item.id, trueName }))}
            />
            <TextField
              label="True value (GM)"
              value={item.secretValue}
              placeholder="e.g. 2,000 gp"
              onCommit={(secretValue) => dispatch(lootActions.setSecret.create({ id: item.id, secretValue }))}
            />
          </div>
          <OptionalNumberField
            label="Caster Level (Identify DC = 15 + CL)"
            value={item.cl}
            min={0}
            max={30}
            placeholder="None"
            onCommit={(cl) => dispatch(lootActions.setSecret.create({ id: item.id, cl: cl === null ? null : Math.round(cl) }))}
          />
          {item.cl !== null && (
            <div className="muted small-text tnum">
              CL {item.cl} · Spellcraft Identify DC <strong>{identifyDc(item.cl)}</strong>
            </div>
          )}
          <TextAreaField
            label={item.identified ? 'True properties (revealed to players)' : 'True properties (GM only until identified)'}
            value={item.secretNotes}
            rows={4}
            placeholder="Actual stats, caster level, curses…"
            onCommit={(secretNotes) => dispatch(lootActions.setSecret.create({ id: item.id, secretNotes }))}
          />
          {!item.identified && item.cl !== null && (
            <CheckboxField
              label="Detect Magic aura revealed (show CL & DC to players)"
              value={item.magicDetected}
              onCommit={(detected) => dispatch(lootActions.setDetected.create({ id: item.id, detected }))}
            />
          )}
          <CheckboxField
            label={`Identified (reveal true properties${item.cl !== null ? ` · DC ${identifyDc(item.cl)}` : ''})`}
            value={item.identified}
            onCommit={(identified) => dispatch(lootActions.setIdentified.create({ id: item.id, identified }))}
          />
        </div>
      ) : (
        <>
          {canSeeCl(self, item) && item.cl !== null && (
            <div className="muted small-text tnum">
              Magic aura: CL {item.cl} · Spellcraft Identify DC <strong>{identifyDc(item.cl)}</strong>
            </div>
          )}
          {item.identified && item.secretNotes && (
            <div className="identified-box">
              <div className="field-label">Identified properties</div>
              <div className="identified-text">{item.secretNotes}</div>
            </div>
          )}
        </>
      )}

      <TakeIntoInventory item={item} self={self} />

      {canDelete && (
        <button
          type="button"
          className="danger"
          onClick={async () => {
            if (await confirmDialog({ title: `Delete "${item.name}"?`, message: 'Remove this item from party loot?', confirmLabel: 'Delete', danger: true })) {
              dispatch(lootActions.remove.create({ id: item.id }));
            }
          }}
        >
          Delete item
        </button>
      )}
    </div>
  );
}

/** Move some or all of this item into a character you play (its notes, value and image go along). */
function TakeIntoInventory({ item, self }: { item: LootItem; self: User }) {
  const characters = useGame((s) => s.characters);
  const mine = useMemo(
    () => Object.values(characters).filter((c) => canManageCharacter(self, c)).sort((a, b) => a.name.localeCompare(b.name)),
    [characters, self],
  );
  const [characterId, setCharacterId] = useState('');
  const [qty, setQty] = useState(1);
  const target = mine.find((c) => c.id === characterId) ?? mine.find((c) => c.ownerId === self.id) ?? mine[0];
  if (!target) return null;
  const max = Math.max(1, item.quantity);
  return (
    <div className="button-row">
      <select value={target.id} onChange={(e) => setCharacterId(e.target.value)} aria-label="Character to give it to">
        {mine.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {max > 1 && (
        <input
          type="number"
          className="inv-give-qty"
          min={1}
          max={max}
          value={Math.min(qty, max)}
          aria-label="How many"
          onChange={(e) => setQty(Math.max(1, Math.min(max, Math.round(Number(e.target.value) || 1))))}
        />
      )}
      <button
        type="button"
        disabled={item.quantity <= 0}
        title={item.quantity <= 0 ? 'Nothing left to take' : "Move into that character's inventory"}
        onClick={() => dispatch(inventoryActions.takeLoot.create({ lootId: item.id, characterId: target.id, itemId: newId(), quantity: Math.min(qty, item.quantity) }))}
      >
        → Inventory
      </button>
    </div>
  );
}

function TreasureGenerator({ onDropped }: { onDropped: (id: string) => void }) {
  const [band, setBand] = useState<TreasureBand>('minor');
  const [type, setType] = useState<TreasureType>('any');
  const [busy, setBusy] = useState(false);
  const [rolled, setRolled] = useState<Awaited<ReturnType<typeof request<'rules.rollTreasure'>>>['items']>([]);

  async function roll() {
    setBusy(true);
    try {
      const res = await request('rules.rollTreasure', { band, type, count: 3 });
      setRolled(res.items);
      if (res.items.length === 0) notify('No items matched that price tier and type');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="treasure-box">
      <div className="field-row">
        <select value={band} onChange={(e) => setBand(e.target.value as TreasureBand)} aria-label="Treasure price band">
          {TREASURE_BANDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as TreasureType)} aria-label="Treasure type">
          {TREASURE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'any' ? 'Any type' : t}
            </option>
          ))}
        </select>
        <button type="button" className="small gold" disabled={busy} onClick={() => void roll()}>
          <Dices size={12} /> Roll
        </button>
      </div>
      {rolled.length > 0 && (
        <ul className="rules-hit-list" style={{ marginTop: 6 }}>
          {rolled.map((r, i) => (
            <li key={`${r.key}-${i}`} className="rules-saved-row small-text">
              <span className="flex1">
                <strong>{r.name}</strong>{' '}
                <span className="muted">
                  {r.cost !== null ? `${r.cost.toLocaleString('en-US')} gp` : ''}
                  {r.cl !== null ? ` · CL ${r.cl}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="small primary"
                onClick={() => {
                  const id = newId();
                  if (dispatch(lootActions.createTreasure.create({ id, item: r.loot.item, secret: r.loot.secret }))) {
                    notify(`Dropped ${r.name} into Party Loot (unidentified)`, 'info');
                    onDropped(id);
                  }
                }}
              >
                + Drop
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
