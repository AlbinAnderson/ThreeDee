/**
 * Character inventory (Epic 4): loadout switcher, load meter, coin purse and
 * a container tree of items with quick steppers, slots and per-item rules data.
 */
import { useMemo, useState } from 'react';
import { BookOpen, Coins as CoinsIcon, Flame, Package, ShoppingBag } from 'lucide-react';
import {
  activeLoadout,
  canControlToken,
  canManageCharacter,
  coinsValue,
  computeCharacterStats,
  containerContentsWeight,
  detectGear,
  formatCp,
  inventoryActions,
  isGm,
  isUnidentifiedLoot,
  litLight,
  lootActions,
  makeItem,
  newId,
  payFromPurse,
  sellValueCp,
  SLOT_LABELS,
  slotOf,
  tokenActions,
  wouldCycle,
  type Character,
  type Coins,
  type GameAction,
  type InventoryItem,
  type InventorySlot,
  type ItemArmor,
  type ItemWeapon,
} from '@vtt/shared';
import { CheckboxField, NumberField, OptionalNumberField, SelectField, TextAreaField, TextField } from '../components/fields';
import { CatalogBuyDialog } from '../rules/CatalogBuyDialog';
import { openRulesCard } from '../rules/store';
import { confirmDialog, promptDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { getSelf, useGameStore } from '../state/gameStore';
import { useGame, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { syncLinkedToken } from './characterActions';

const SLOT_OPTIONS = (Object.keys(SLOT_LABELS) as InventorySlot[]).map((value) => ({ value, label: SLOT_LABELS[value] }));
const lb = (n: number) => `${Math.round(n * 100) / 100} lb`;
const gp = (n: number) => `${Math.round(n * 100) / 100} gp`;

/** Dispatch an inventory action, then refresh the linked token's carried light only when it changed. */
function useInventoryDispatch(c: Character) {
  return (action: GameAction) => {
    const beforeLit = litLight(c.inventory);
    const ok = dispatch(action);
    if (!ok) return false;
    if (action.type === 'inventory/setCoins' || action.type === 'inventory/renameLoadout') return true;
    const after = useGameStore.getState().view?.characters[c.id];
    const lightItemsBefore = c.inventory.items.filter((i) => i.light);
    const removedLastLitViaGive =
      action.type === 'inventory/giveToLoot' &&
      lightItemsBefore.length === 1 &&
      lightItemsBefore[0]!.id === action.payload.itemId &&
      lightItemsBefore[0]!.lit &&
      action.payload.quantity >= lightItemsBefore[0]!.quantity;
    const removedLastLit = !!beforeLit && (removedLastLitViaGive || (action.type !== 'inventory/giveToLoot' && !!after && !after.inventory.items.some((i) => i.light)));
    if (removedLastLit && c.tokenId) {
      const state = useGameStore.getState().view;
      const self = getSelf();
      const token = state?.tokens[c.tokenId];
      if (token && self && canControlToken(self, token) && token.light) {
        dispatch(tokenActions.update.create({ id: token.id, changes: { light: null } }));
      }
      return true;
    }
    const afterLit = after ? litLight(after.inventory) : null;
    const litChanged =
      action.type === 'inventory/giveToLoot'
        ? !!beforeLit
        : (beforeLit?.bright ?? null) !== (afterLit?.bright ?? null) || (beforeLit?.dim ?? null) !== (afterLit?.dim ?? null);
    if (litChanged) syncLinkedToken(c);
    return true;
  };
}

export function InventoryTab({ character: c }: { character: Character }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const stats = useMemo(() => computeCharacterStats(c), [c]);
  const inv = c.inventory;
  const act = useInventoryDispatch(c);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);

  const children = useMemo(() => {
    const map = new Map<string | null, InventoryItem[]>();
    const ids = new Set(inv.items.map((i) => i.id));
    for (const item of inv.items) {
      const parent = item.containerId && ids.has(item.containerId) ? item.containerId : null;
      map.set(parent, [...(map.get(parent) ?? []), item]);
    }
    return map;
  }, [inv.items]);

  function addItem() {
    const name = newName.trim();
    if (!name) return;
    const item = makeItem({ id: newId(), name: name.slice(0, 120), ...detectGear(name) });
    if (act(inventoryActions.addItem.create({ characterId: c.id, item }))) {
      setNewName('');
      setOpenId(item.id);
    }
  }

  const renderItems = (parent: string | null, depth: number, seen = new Set<string>()): React.ReactNode =>
    (children.get(parent) ?? [])
      .filter((item) => !seen.has(item.id))
      .map((item) => {
        const nextSeen = new Set(seen);
        nextSeen.add(item.id);
        return (
          <li key={item.id} className={openId === item.id ? 'open' : ''}>
            <ItemRow character={c} item={item} depth={depth} manage={manage} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} act={act} />
            {openId === item.id && <ItemEditor character={c} item={item} manage={manage} act={act} />}
            {item.container && (children.get(item.id)?.length ?? 0) > 0 && <ul className="inv-children">{renderItems(item.id, depth + 1, nextSeen)}</ul>}
          </li>
        );
      });

  return (
    <div className="inventory">
      <LoadoutBar character={c} manage={manage} act={act} />
      <LoadMeter stats={stats} />
      <Purse character={c} manage={manage} act={act} />

      <section>
        <div className="section-header">
          <h3>Gear</h3>
          <span className="muted small-text">{inv.items.length} items · worth {gp(inv.items.reduce((s, i) => s + i.value * i.quantity, 0))}</span>
          {manage && (
            <button type="button" className="small gold" onClick={() => setCatalogOpen(true)} title="Search rules catalog, add mods & buy from purse">
              <ShoppingBag size={12} /> Catalog / Shop
            </button>
          )}
        </div>
        {inv.items.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="inv-list">{renderItems(null, 0)}</ul>
        {manage && (
          <div className="field-row">
            <input
              placeholder="Add item (e.g. Torch, Longbow, Bag of Holding)"
              value={newName}
              maxLength={120}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
            />
            <button type="button" className="primary" onClick={addItem} disabled={!newName.trim()}>
              + Add
            </button>
          </div>
        )}
        <p className="muted small-text">
          Slots are per loadout: <em>Not carried</em> gear (and anything inside it) doesn’t count toward your load. Known weapons, armor, lights and
          containers fill in their stats automatically; open an item to adjust them.
        </p>
      </section>
      {catalogOpen && <CatalogBuyDialog character={c} onClose={() => setCatalogOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ loadouts

function LoadoutBar({ character: c, manage, act }: { character: Character; manage: boolean; act: (a: GameAction) => boolean }) {
  const inv = c.inventory;
  const current = activeLoadout(inv);
  const create = async (copy: boolean) => {
    const name = (
      await promptDialog({
        title: copy ? `Copy "${current.name}"` : 'New loadout',
        label: 'Loadout name',
        defaultValue: copy ? `${current.name} (copy)` : 'Combat',
        confirmLabel: 'Create',
        maxLength: 60,
      })
    )?.trim();
    if (name) act(inventoryActions.createLoadout.create({ characterId: c.id, loadoutId: newId(), name: name.slice(0, 60), copyFrom: copy ? current.id : undefined }));
  };
  return (
    <div className="inv-loadouts">
      <label className="field-label" htmlFor="inv-loadout">
        Loadout
      </label>
      <select
        id="inv-loadout"
        value={current.id}
        disabled={!manage}
        title="Equipment set: switch in one click (e.g. drop the backpack when a fight starts)"
        onChange={(e) => act(inventoryActions.setActiveLoadout.create({ characterId: c.id, loadoutId: e.target.value }))}
      >
        {inv.loadouts.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {manage && (
        <>
          <button type="button" className="small" title="Copy this loadout" onClick={() => void create(true)}>
            Copy
          </button>
          <button type="button" className="small" title="New loadout (everything carried)" onClick={() => void create(false)}>
            New
          </button>
          <button
            type="button"
            className="small"
            onClick={async () => {
              const name = (await promptDialog({ title: 'Rename loadout', label: 'Loadout name', defaultValue: current.name, confirmLabel: 'Rename', maxLength: 60 }))?.trim();
              if (name && name !== current.name) act(inventoryActions.renameLoadout.create({ characterId: c.id, loadoutId: current.id, name: name.slice(0, 60) }));
            }}
          >
            Rename
          </button>
          {inv.loadouts.length > 1 && (
            <button
              type="button"
              className="small danger"
              onClick={async () => {
                if (await confirmDialog({ title: `Delete loadout "${current.name}"?`, message: 'Items stay in your inventory; only this loadout preset is deleted.', confirmLabel: 'Delete', danger: true })) {
                  act(inventoryActions.deleteLoadout.create({ characterId: c.id, loadoutId: current.id }));
                }
              }}
            >
              Delete
            </button>
          )}
        </>
      )}
    </div>
  );
}

function LoadMeter({ stats }: { stats: ReturnType<typeof computeCharacterStats> }) {
  const { weight, capacity, level } = stats.load;
  const pct = capacity.heavy > 0 ? Math.min(100, (weight.total / capacity.heavy) * 100) : weight.total > 0 ? 100 : 0;
  const color = level === 'light' ? '#40c057' : level === 'medium' ? '#fab005' : '#fa5252';
  const effects =
    level === 'light'
      ? null
      : level === 'overloaded'
        ? 'Overloaded: can only stagger 5 ft'
        : `${level === 'medium' ? 'Medium' : 'Heavy'} load: max Dex +${level === 'medium' ? 3 : 1}, ${level === 'medium' ? '−3' : '−6'} check penalty, slower speed`;
  return (
    <div className="inv-load" title={`Gear ${lb(weight.gear)} + coins ${lb(weight.coins)}${weight.extradimensional ? `; ${lb(weight.extradimensional)} in extradimensional space not counted` : ''}`}>
      <div className="inv-load-numbers">
        <strong>{lb(weight.total)}</strong>
        <span className="muted">
          {' '}
          · {level} load · light ≤ {capacity.light}, medium ≤ {capacity.medium}, heavy ≤ {capacity.heavy}
        </span>
      </div>
      <div className="hp-bar-html">
        <div style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="muted small-text">
        {[effects, stats.armor.acp ? `Armor check penalty ${stats.armor.acp}` : null, stats.armor.asf ? `Arcane spell failure ${stats.armor.asf}%` : null]
          .filter(Boolean)
          .join(' · ') || 'No load or armor penalties.'}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ purse

function Purse({ character: c, manage, act }: { character: Character; manage: boolean; act: (a: GameAction) => boolean }) {
  const coins = c.inventory.coins;
  const [amount, setAmount] = useState('');
  const setCoins = (next: Coins) => act(inventoryActions.setCoins.create({ characterId: c.id, coins: next }));
  const change = (sign: 1 | -1) => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    const cp = Math.round(n * 100);
    if (sign > 0) {
      setCoins({
        ...coins,
        gp: Math.min(1e9, coins.gp + Math.floor(cp / 100)),
        sp: Math.min(1e9, coins.sp + Math.floor((cp % 100) / 10)),
        cp: Math.min(1e9, coins.cp + (cp % 10)),
      });
    } else {
      const next = payFromPurse(coins, cp);
      if (!next) return notify(`Not enough coins (you have ${gp(coinsValue(coins))})`);
      setCoins(next);
    }
    setAmount('');
  };
  return (
    <section>
      <div className="section-header">
        <h3>Purse</h3>
        <span className="muted small-text">
          {gp(coinsValue(coins))} · {lb((coins.pp + coins.gp + coins.sp + coins.cp) / 50)}
        </span>
      </div>
      <div className="inv-coins">
        {(['pp', 'gp', 'sp', 'cp'] as const).map((k) => (
          <NumberField
            key={k}
            label={k}
            value={coins[k]}
            min={0}
            max={1e9}
            step={1}
            disabled={!manage}
            onCommit={(v) => setCoins({ ...coins, [k]: Math.round(v) })}
          />
        ))}
      </div>
      {manage && (
        <div className="field-row">
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="Amount in gp"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && change(-1)}
          />
          <button type="button" className="small" title="Pay this much, making change from larger coins" onClick={() => change(-1)}>
            Spend
          </button>
          <button type="button" className="small" title="Add this much as gold, silver and copper" onClick={() => change(1)}>
            Receive
          </button>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ items

function ItemRow({
  character: c,
  item,
  depth,
  manage,
  open,
  onToggle,
  act,
}: {
  character: Character;
  item: InventoryItem;
  depth: number;
  manage: boolean;
  open: boolean;
  onToggle: () => void;
  act: (a: GameAction) => boolean;
}) {
  const loot = useGame((s) => s.loot);
  const inv = c.inventory;
  const loadout = activeLoadout(inv);
  const slot = slotOf(loadout, item.id);
  const container = item.containerId ? inv.items.find((i) => i.id === item.containerId) : undefined;
  const unidentified = isUnidentifiedLoot({ loot }, item);
  const adjust = (changes: { quantity?: number; charges?: number }) => act(inventoryActions.adjust.create({ characterId: c.id, itemId: item.id, ...changes }));
  return (
    <div className={`inv-row${slot === 'notCarried' && !container ? ' not-carried' : ''}`} style={{ paddingLeft: depth * 14 }}>
      <button type="button" className="inv-name" onClick={onToggle} aria-expanded={open} title={item.notes || undefined}>
        {item.container && <Package size={12} className="muted" style={{ flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
        {item.quantity !== 1 && <span className="muted">×{item.quantity}</span>}
        {unidentified && <span className="badge subtle">unidentified</span>}
      </button>
      {item.charges && (
        <span className="inv-stepper" title="Charges">
          {manage && (
            <button type="button" className="small" aria-label={`Use a charge of ${item.name}`} onClick={() => adjust({ charges: -1 })}>
              −
            </button>
          )}
          <span className="small-text">
            {item.charges.current}/{item.charges.max} ch
          </span>
          {manage && (
            <button type="button" className="small" aria-label={`Restore a charge of ${item.name}`} onClick={() => adjust({ charges: 1 })}>
              +
            </button>
          )}
        </span>
      )}
      {manage && (
        <span className="inv-stepper" title="Quantity">
          <button type="button" className="small" aria-label={`One less ${item.name}`} onClick={() => adjust({ quantity: -1 })}>
            −
          </button>
          <button type="button" className="small" aria-label={`One more ${item.name}`} onClick={() => adjust({ quantity: 1 })}>
            +
          </button>
        </span>
      )}
      {item.light && manage && (
        <button
          type="button"
          className={`small${item.lit ? ' active' : ''}`}
          title={item.lit ? 'Put it out' : `Light it (${item.light.bright} ft bright, ${item.light.dim} ft dim on your token)`}
          onClick={() => act(inventoryActions.setLit.create({ characterId: c.id, itemId: item.id, lit: !item.lit }))}
        >
          {item.lit ? (
            <>
              <Flame size={12} /> Lit
            </>
          ) : (
            'Light'
          )}
        </button>
      )}
      {container ? (
        <span className="muted small-text inv-where">in {container.name}</span>
      ) : (
        <select
          className="inv-slot"
          value={slot}
          disabled={!manage}
          aria-label={`Slot for ${item.name}`}
          onChange={(e) => act(inventoryActions.setSlot.create({ characterId: c.id, itemId: item.id, slot: e.target.value as InventorySlot }))}
        >
          {SLOT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <span className="muted small-text inv-weight" title={item.container ? 'Contents' : 'Weight'}>
        {item.container ? containerLoad(c, item) : item.weight ? lb(item.weight * item.quantity) : ''}
      </span>
    </div>
  );
}

function ItemEditor({ character: c, item, manage, act }: { character: Character; item: InventoryItem; manage: boolean; act: (a: GameAction) => boolean }) {
  const self = useSelf();
  const loot = useGame((s) => s.loot);
  const gm = isGm(self);
  const inv = c.inventory;
  const lootRecord = item.lootId ? loot[item.lootId] : undefined;
  const update = (changes: Parameters<typeof inventoryActions.updateItem.create>[0]['changes']) =>
    act(inventoryActions.updateItem.create({ characterId: c.id, itemId: item.id, changes }));
  const containers = inv.items.filter((i) => i.container && i.id !== item.id && !wouldCycle(inv, item.id, i.id));
  const [giveQty, setGiveQty] = useState(item.quantity);

  if (!manage) {
    return (
      <div className="loot-editor">
        {item.notes && <div className="identified-text">{item.notes}</div>}
        <ItemFacts item={item} />
      </div>
    );
  }

  return (
    <div className="loot-editor">
      {item.imageUrl && <img className="loot-image" src={item.imageUrl} alt={item.name} />}
      <TextField label="Name" value={item.name} onCommit={(name) => name.trim() && update({ name: name.trim().slice(0, 120) })} />
      <div className="field-row">
        <NumberField label="Qty" value={item.quantity} min={0} max={1_000_000} step={1} onCommit={(quantity) => update({ quantity: Math.round(quantity) })} />
        <NumberField label="Weight each (lb)" value={item.weight} min={0} max={100000} step={0.1} onCommit={(weight) => update({ weight })} />
        <NumberField label="Value each (gp)" value={item.value} min={0} max={1e9} step={0.01} onCommit={(value) => update({ value })} />
      </div>
      <SelectField
        label="Inside"
        value={item.containerId ?? ''}
        options={[{ value: '', label: '— not in a container —' }, ...containers.map((x) => ({ value: x.id, label: x.name }))]}
        onCommit={(v) => act(inventoryActions.moveItem.create({ characterId: c.id, itemId: item.id, containerId: v || null }))}
      />
      <TextAreaField label="Notes" value={item.notes} rows={2} onCommit={(notes) => update({ notes: notes.slice(0, 4000) })} />

      {lootRecord && (
        <div className={gm ? 'gm-box' : 'identified-box'}>
          {gm ? (
            <>
              <TextAreaField
                label={lootRecord.identified ? 'True properties (revealed)' : 'True properties (GM only until identified)'}
                value={lootRecord.secretNotes}
                rows={3}
                onCommit={(secretNotes) => dispatch(lootActions.setSecret.create({ id: lootRecord.id, secretNotes }))}
              />
              <CheckboxField
                label="Identified (reveal true properties)"
                value={lootRecord.identified}
                onCommit={(identified) => dispatch(lootActions.setIdentified.create({ id: lootRecord.id, identified }))}
              />
            </>
          ) : lootRecord.identified ? (
            lootRecord.secretNotes && (
              <>
                <div className="field-label">Identified properties</div>
                <div className="identified-text">{lootRecord.secretNotes}</div>
              </>
            )
          ) : (
            <div className="muted small-text">From the party loot, not identified yet.</div>
          )}
        </div>
      )}

      <details className="inspector-section">
        <summary>Rules data</summary>
        <ItemRules item={item} update={update} />
      </details>

      <div className="button-row">
        <input
          type="number"
          className="inv-give-qty"
          min={1}
          max={Math.max(1, item.quantity)}
          value={Math.max(1, Math.min(Math.max(1, item.quantity), giveQty))}
          disabled={item.quantity <= 0}
          aria-label="Quantity to give"
          onChange={(e) => setGiveQty(Math.max(1, Math.min(Math.max(1, item.quantity), Math.round(Number(e.target.value) || 1))))}
        />
        <button
          type="button"
          disabled={item.quantity <= 0}
          title={item.quantity <= 0 ? 'Nothing left to move' : 'Move to the shared party Loot'}
          onClick={() => act(inventoryActions.giveToLoot.create({ characterId: c.id, itemId: item.id, quantity: Math.max(1, Math.min(giveQty, item.quantity)), newLootId: newId() }))}
        >
          → Party loot
        </button>
        {(!lootRecord || lootRecord.identified) && item.quantity > 0 && item.value > 0 && (
          <button
            type="button"
            className="small gold"
            title={item.tradeGood ? 'Sell trade good at full value (100%)' : 'Sell item at half price (50%)'}
            onClick={async () => {
              const q = Math.max(1, Math.min(giveQty, item.quantity));
              const payout = sellValueCp(item, q);
              if (
                await confirmDialog({
                  title: `Sell ${q > 1 ? `${q}× ` : ''}${item.name}?`,
                  message: `Sell for ${formatCp(payout)} (${item.tradeGood ? '100% trade good' : '50% market value'}) and add the coins to ${c.name}’s purse?`,
                  confirmLabel: `Sell (${formatCp(payout)})`,
                })
              ) {
                act(inventoryActions.sellItem.create({ characterId: c.id, itemId: item.id, quantity: q }));
              }
            }}
          >
            <CoinsIcon size={12} /> Sell
          </button>
        )}
        <button
          type="button"
          className="small"
          title="Open rules card & Archives of Nethys link"
          onClick={() =>
            openRulesCard({
              kind: 'equipment',
              key: item.ruleKey && !item.ruleKey.startsWith('custom:') ? item.ruleKey : undefined,
              customId: item.ruleKey?.startsWith('custom:') ? item.ruleKey.slice(7) : undefined,
              name: item.name,
            })
          }
        >
          <BookOpen size={12} /> Rules / AoN
        </button>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            if (await confirmDialog({ title: `Delete "${item.name}"?`, message: item.container ? 'Its contents will remain in your inventory.' : 'Remove this item from your inventory?', confirmLabel: 'Delete', danger: true })) {
              act(inventoryActions.removeItem.create({ characterId: c.id, itemId: item.id }));
            }
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ItemFacts({ item }: { item: InventoryItem }) {
  const facts = [
    item.weapon && `${item.weapon.damage} ${item.weapon.critRange < 20 ? `${item.weapon.critRange}-20/` : ''}×${item.weapon.critMult}${item.weapon.range ? `, ${item.weapon.range} ft` : ''}`,
    item.armor && `${item.armor.kind === 'shield' ? 'Shield' : 'Armor'} +${item.armor.bonus + item.armor.enhancement}, ACP ${item.armor.acp}, ASF ${item.armor.asf}%`,
    item.light && `Light ${item.light.bright}/${item.light.dim} ft`,
    item.container && (item.container.extradimensional ? 'Extradimensional container' : 'Container'),
    item.value ? `${gp(item.value)} each` : null,
  ].filter(Boolean);
  return facts.length ? <div className="muted small-text">{facts.join(' · ')}</div> : null;
}

const DEFAULT_WEAPON: ItemWeapon = { damage: '1d6', critRange: 20, critMult: 2, range: 0, type: 'melee', hands: 'one', strDamage: 'full', finesse: false, enhancement: 0, masterwork: false };
const DEFAULT_ARMOR: ItemArmor = { kind: 'armor', category: 'light', bonus: 1, enhancement: 0, maxDex: null, acp: 0, asf: 0 };

/** Editable weapon / armor / light / container / charges data. */
function ItemRules({ item, update }: { item: InventoryItem; update: (changes: Partial<InventoryItem>) => boolean }) {
  const w = item.weapon;
  const a = item.armor;
  const setW = (changes: Partial<ItemWeapon>) => update({ weapon: { ...(w ?? DEFAULT_WEAPON), ...changes } });
  const setA = (changes: Partial<ItemArmor>) => update({ armor: { ...(a ?? DEFAULT_ARMOR), ...changes } });
  return (
    <div className="inv-rules">
      <CheckboxField label="Weapon" value={!!w} onCommit={(on) => update({ weapon: on ? (detectGear(item.name).weapon ?? DEFAULT_WEAPON) : null })} />
      {w && (
        <>
          <div className="field-row">
            <TextField label="Damage (Medium)" value={w.damage} onCommit={(damage) => /^[1-9]\d?d[1-9]\d{0,2}$/.test(damage.trim()) ? setW({ damage: damage.trim() }) : notify('Damage like 1d8')} />
            <NumberField label="Threat from" value={w.critRange} min={2} max={20} step={1} onCommit={(critRange) => setW({ critRange: Math.round(critRange) })} />
            <NumberField label="Crit ×" value={w.critMult} min={2} max={6} step={1} onCommit={(critMult) => setW({ critMult: Math.round(critMult) })} />
          </div>
          <div className="field-row">
            <SelectField label="Type" value={w.type} options={[{ value: 'melee', label: 'Melee' }, { value: 'thrown', label: 'Thrown' }, { value: 'ranged', label: 'Ranged' }]} onCommit={(type) => setW({ type })} />
            <SelectField label="Handedness" value={w.hands} options={[{ value: 'light', label: 'Light' }, { value: 'one', label: 'One-handed' }, { value: 'two', label: 'Two-handed' }]} onCommit={(hands) => setW({ hands })} />
            <NumberField label="Range (ft)" value={w.range} min={0} max={1000} step={5} onCommit={(range) => setW({ range: Math.round(range) })} />
          </div>
          <div className="field-row">
            <SelectField
              label="Str to damage"
              value={w.strDamage}
              options={[{ value: 'full', label: 'Full' }, { value: 'penalty', label: 'Penalty only' }, { value: 'none', label: 'None' }]}
              onCommit={(strDamage) => setW({ strDamage })}
            />
            <NumberField label="Enhancement" value={w.enhancement} min={0} max={10} step={1} onCommit={(enhancement) => setW({ enhancement: Math.round(enhancement) })} />
          </div>
          <div className="field-row">
            <CheckboxField label="Masterwork" value={w.masterwork} onCommit={(masterwork) => setW({ masterwork })} />
            <CheckboxField label="Finesse" value={w.finesse} onCommit={(finesse) => setW({ finesse })} />
          </div>
        </>
      )}
      <CheckboxField label="Armor / shield" value={!!a} onCommit={(on) => update({ armor: on ? (detectGear(item.name).armor ?? DEFAULT_ARMOR) : null })} />
      {a && (
        <>
          <div className="field-row">
            <SelectField label="Kind" value={a.kind} options={[{ value: 'armor', label: 'Armor' }, { value: 'shield', label: 'Shield' }]} onCommit={(kind) => setA({ kind, category: kind === 'shield' ? 'shield' : a.category === 'shield' ? 'light' : a.category })} />
            {a.kind === 'armor' && (
              <SelectField label="Category" value={a.category} options={[{ value: 'light', label: 'Light' }, { value: 'medium', label: 'Medium' }, { value: 'heavy', label: 'Heavy' }]} onCommit={(category) => setA({ category })} />
            )}
          </div>
          <div className="field-row">
            <NumberField label="AC bonus" value={a.bonus} min={0} max={40} step={1} onCommit={(bonus) => setA({ bonus: Math.round(bonus) })} />
            <NumberField label="Enhancement" value={a.enhancement} min={0} max={10} step={1} onCommit={(enhancement) => setA({ enhancement: Math.round(enhancement) })} />
            <OptionalNumberField label="Max Dex" value={a.maxDex} min={0} max={20} placeholder="none" onCommit={(maxDex) => setA({ maxDex })} />
          </div>
          <div className="field-row">
            <NumberField label="Check penalty" value={a.acp} min={-20} max={0} step={1} onCommit={(acp) => setA({ acp: Math.round(acp) })} />
            <NumberField label="Spell failure %" value={a.asf} min={0} max={100} step={5} onCommit={(asf) => setA({ asf: Math.round(asf) })} />
          </div>
        </>
      )}
      <CheckboxField label="Light source" value={!!item.light} onCommit={(on) => update({ light: on ? (detectGear(item.name).light ?? { bright: 20, dim: 40 }) : null, lit: false })} />
      {item.light && (
        <div className="field-row">
          <NumberField label="Bright (ft)" value={item.light.bright} min={0} max={1000} step={5} onCommit={(bright) => update({ light: { ...item.light!, bright: Math.round(bright) } })} />
          <NumberField label="Dim (ft)" value={item.light.dim} min={0} max={2000} step={5} onCommit={(dim) => update({ light: { ...item.light!, dim: Math.round(dim) } })} />
        </div>
      )}
      <CheckboxField label="Container" value={!!item.container} onCommit={(on) => update({ container: on ? (detectGear(item.name).container ?? { extradimensional: false, capacity: null }) : null })} />
      {item.container && (
        <div className="field-row">
          <CheckboxField
            label="Extradimensional (contents weigh nothing)"
            value={item.container.extradimensional}
            onCommit={(extradimensional) => update({ container: { ...item.container!, extradimensional } })}
          />
          <OptionalNumberField label="Capacity (lb)" value={item.container.capacity} min={0} max={100000} placeholder="—" onCommit={(capacity) => update({ container: { ...item.container!, capacity } })} />
        </div>
      )}
      <CheckboxField label="Charges" value={!!item.charges} onCommit={(on) => update({ charges: on ? (detectGear(item.name).charges ?? { current: 50, max: 50 }) : null })} />
      {item.charges && (
        <div className="field-row">
          <NumberField label="Charges left" value={item.charges.current} min={0} max={item.charges.max} step={1} onCommit={(current) => update({ charges: { ...item.charges!, current: Math.round(current) } })} />
          <NumberField label="Max" value={item.charges.max} min={0} max={10000} step={1} onCommit={(max) => update({ charges: { max: Math.round(max), current: Math.min(item.charges!.current, Math.round(max)) } })} />
        </div>
      )}
    </div>
  );
}

/** "12 / 60 lb" for a container's contents. */
export function containerLoad(c: Character, item: InventoryItem): string | null {
  if (!item.container) return null;
  const used = containerContentsWeight(c.inventory, item.id);
  return item.container.capacity ? `${lb(used)} / ${item.container.capacity} lb` : lb(used);
}
