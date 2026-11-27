/**
 * Equipment catalog search, equipment mods (Masterwork / Special Materials / +N),
 * and shopping (Buy from purse with automatic change, or Add free) (Epic 11, #54 & #57).
 */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Coins, Plus, ShoppingBag, X } from 'lucide-react';
import {
  allowedMods,
  coinsValue,
  inventoryActions,
  itemFromRecord,
  MATERIAL_LABELS,
  newId,
  NO_MODS,
  priceCp,
  priceWithMods,
  type Character,
  type CustomRule,
  type EquipmentRecord,
  type ItemMods,
  type Material,
  type RulesHit,
} from '@vtt/shared';
import { request } from '../net/rpc';
import { dispatch } from '../state/dispatch';
import { notify } from '../state/notifications';
import { openRulesCard } from './store';

export function CatalogBuyDialog({ character: c, onClose }: { character: Character; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<RulesHit[]>([]);
  const [selected, setSelected] = useState<{ rec: EquipmentRecord | null; custom: CustomRule | null } | null>(null);
  const [mods, setMods] = useState<ItemMods>(NO_MODS);
  const [qtyDraft, setQtyDraft] = useState('1');

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      request('rules.search', { kind: 'equipment', q, limit: 35 })
        .then((res) => alive && setHits(res))
        .catch(() => alive && setHits([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  async function pick(hit: RulesHit) {
    try {
      const res = await request('rules.get', {
        kind: 'equipment',
        ...(hit.customId ? { customId: hit.customId } : { key: hit.key }),
        name: hit.name,
      });
      setSelected({ rec: (res.record as EquipmentRecord | null) ?? null, custom: res.custom });
      setMods(NO_MODS);
      setQtyDraft('1');
    } catch (e) {
      notify((e as Error).message);
    }
  }

  const qty = Math.max(1, Math.min(10000, Math.floor(Number(qtyDraft) || 1)));
  const modCaps = selected?.rec ? allowedMods(selected.rec) : { masterwork: false, enhancement: false, materials: ['none'] as Material[] };
  const priced = useMemo(() => {
    if (!selected?.rec) return null;
    return priceWithMods(selected.rec, mods);
  }, [selected, mods]);

  const unitCost = selected?.custom ? selected.custom.cost : priced && typeof priced !== 'string' ? priced.cost : null;
  const totalCp = unitCost !== null ? priceCp(unitCost, qty) : null;
  const purseGp = coinsValue(c.inventory.coins);
  const canAfford = totalCp !== null && Math.round(purseGp * 100) >= totalCp;

  function buy() {
    if (!selected) return;
    const ok = dispatch(
      inventoryActions.buyItem.create({
        characterId: c.id,
        itemId: newId(),
        quantity: qty,
        ...(selected.custom ? { customRuleId: selected.custom.id } : { ruleKey: selected.rec!.key, mods }),
      }),
    );
    if (ok) {
      notify(`Bought ${qty > 1 ? `${qty}× ` : ''}${selected.custom?.name ?? (priced && typeof priced !== 'string' ? priced.name : selected.rec?.name)}`, 'info');
      onClose();
    }
  }

  function addFree() {
    if (!selected?.rec) return;
    const item = itemFromRecord(selected.rec, newId(), mods, qty);
    if (typeof item === 'string') return notify(item);
    if (dispatch(inventoryActions.addItem.create({ characterId: c.id, item }))) {
      notify(`Added ${item.name} to ${c.name}`, 'info');
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card rules-modal" role="dialog" aria-label="Equipment Catalog & Shop">
        <div className="section-header">
          <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ShoppingBag size={15} /> Catalog &amp; Shop — {c.name}
          </h3>
          <span className="muted small-text tnum">
            <Coins size={12} /> Purse: {purseGp.toLocaleString('en-US', { maximumFractionDigits: 2 })} gp
          </span>
          <button type="button" className="icon-button" aria-label="Close catalog" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search weapons, armor, gear, magic items…" autoFocus />

        <div className="rules-catalog-split">
          <ul className="rules-hit-list">
            {hits.map((h) => (
              <li key={h.key}>
                <button
                  type="button"
                  className={`rules-hit-btn${(selected?.rec?.key === h.key || selected?.custom?.id === h.customId) ? ' active' : ''}`}
                  onClick={() => void pick(h)}
                >
                  <span className="rules-hit-main">
                    <strong>{h.name}</strong>
                    <span className="muted small-text">{h.summary}</span>
                  </span>
                </button>
              </li>
            ))}
            {hits.length === 0 && <li className="muted small-text">No equipment matches (ensure rules pack is built or add custom items).</li>}
          </ul>

          {selected && (selected.rec || selected.custom) && (
            <div className="rules-draft-box small-text">
              <div className="section-header">
                <strong>{selected.custom?.name ?? (priced && typeof priced !== 'string' ? priced.name : selected.rec?.name)}</strong>
                <button
                  type="button"
                  className="icon-button"
                  title="Open full rules card & AoN link"
                  onClick={() =>
                    openRulesCard({
                      kind: 'equipment',
                      key: selected.rec?.key,
                      customId: selected.custom?.id,
                      name: selected.custom?.name ?? selected.rec!.name,
                    })
                  }
                >
                  <BookOpen size={13} />
                </button>
              </div>

              {selected.rec && (modCaps.masterwork || modCaps.enhancement || modCaps.materials.length > 1) && (
                <div className="rules-mods">
                  {modCaps.masterwork && (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={mods.masterwork || mods.enhancement > 0}
                        disabled={mods.enhancement > 0}
                        onChange={(e) => setMods({ ...mods, masterwork: e.target.checked })}
                      />
                      Masterwork
                    </label>
                  )}
                  {modCaps.materials.length > 1 && (
                    <select value={mods.material} onChange={(e) => setMods({ ...mods, material: e.target.value as Material })} aria-label="Special material">
                      {modCaps.materials.map((m) => (
                        <option key={m} value={m}>
                          {MATERIAL_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  )}
                  {modCaps.enhancement && (
                    <select value={mods.enhancement} onChange={(e) => setMods({ ...mods, enhancement: Number(e.target.value) })} aria-label="Enhancement bonus">
                      {[0, 1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? 'Non-magical (+0)' : `+${n} enhancement`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="field-row" style={{ marginTop: 6 }}>
                <label className="small-text">
                  Qty{' '}
                  <input style={{ width: 64 }} value={qtyDraft} onChange={(e) => setQtyDraft(e.target.value)} inputMode="numeric" />
                </label>
                <span className="tnum">
                  <strong>Total:</strong> {totalCp !== null ? `${(totalCp / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} gp` : 'No price'}
                </span>
              </div>

              {typeof priced === 'string' && <p className="warn-text">{priced}</p>}
              {priced && typeof priced !== 'string' && priced.parts.length > 1 && (
                <ul className="muted" style={{ paddingLeft: 16, margin: '4px 0' }}>
                  {priced.parts.map((p, i) => (
                    <li key={`${p.label}-${i}`}>
                      {p.label}: {p.gp.toLocaleString('en-US')} gp
                    </li>
                  ))}
                </ul>
              )}

              <div className="button-row" style={{ marginTop: 8 }}>
                <button type="button" className="small gold" disabled={!canAfford} onClick={buy} title={canAfford ? 'Deducts from purse with change' : 'Not enough coin in purse'}>
                  <Coins size={12} /> Buy
                </button>
                {selected.rec && (
                  <button type="button" className="small" disabled={typeof priced === 'string'} onClick={addFree} title="Add without spending gold">
                    <Plus size={12} /> Add free
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
