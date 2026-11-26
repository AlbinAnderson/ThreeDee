/**
 * Character inventory helpers: seeding from a .pcg build, where an item is in
 * the active loadout, and what counts toward load. Pure; shared by the
 * engine, the actions and the UI.
 */
import type { Coins, Inventory, InventoryItem, InventorySlot, Loadout } from '../entities/pf1e';
import type { PcgenCharacter, PcgenEquipmentItem } from '../pcgen/schema';
import { coinsFromGp, COINS_PER_POUND, detectGear } from './gear';

export const SLOT_LABELS: Record<InventorySlot, string> = {
  carried: 'Carried',
  notCarried: 'Not carried',
  primary: 'Main hand',
  offHand: 'Off hand',
  bothHands: 'Both hands',
  armor: 'Armor',
  shield: 'Shield',
  head: 'Head',
  headband: 'Headband',
  eyes: 'Eyes',
  shoulders: 'Shoulders',
  neck: 'Neck',
  chest: 'Chest',
  body: 'Body',
  belt: 'Belt',
  wrists: 'Wrists',
  hands: 'Hands',
  ring: 'Ring',
  feet: 'Feet',
};

export const HAND_SLOTS: InventorySlot[] = ['primary', 'offHand', 'bothHands'];

/** PCGen equip-set location -> slot. Unknown locations count as carried. */
export function slotFromPcgLocation(location: string): InventorySlot {
  const l = location.trim().toLowerCase();
  if (l === 'not carried') return 'notCarried';
  if (l === 'primary hand' || l === 'primary') return 'primary';
  if (l === 'secondary hand' || l === 'off hand' || l === 'off-hand') return 'offHand';
  if (l === 'both hands' || l === 'double weapon' || l === 'two hands') return 'bothHands';
  if (l === 'armor') return 'armor';
  if (l === 'shield') return 'shield';
  if (l === 'head') return 'head';
  if (l === 'headband') return 'headband';
  if (l === 'eyes' || l === 'face') return 'eyes';
  if (l === 'shoulders' || l === 'shoulder') return 'shoulders';
  if (l === 'neck') return 'neck';
  if (l === 'chest') return 'chest';
  if (l === 'torso' || l === 'body' || l === 'robe') return 'body';
  if (l === 'belt' || l === 'waist') return 'belt';
  if (l === 'wrists' || l === 'wrist' || l === 'arms') return 'wrists';
  if (l === 'hands' || l === 'gloves') return 'hands';
  if (l.startsWith('ring') || l === 'fingers') return 'ring';
  if (l === 'feet' || l === 'boots') return 'feet';
  return 'carried';
}

const emptyCoins = (): Coins => ({ pp: 0, gp: 0, sp: 0, cp: 0 });

/** New inventory item with defaults for everything not given. */
export function makeItem(fields: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    quantity: 1,
    weight: 0,
    value: 0,
    notes: '',
    containerId: null,
    charges: null,
    armor: null,
    weapon: null,
    light: null,
    lit: false,
    container: null,
    lootId: null,
    imageUrl: null,
    ...fields,
  };
}

/** A PCGen EQUIPNAME as an inventory item, with rules data detected from its name. */
export function itemFromPcg(e: PcgenEquipmentItem, id: string): InventoryItem {
  const custom = e.customization;
  const eqmods = custom ? Object.entries(custom.data).map(([k, v]) => `${k}=${v.join('.')}`).join(' ') : '';
  const mods = custom?.data.EQMOD?.join(', ');
  const notes = [e.note, mods ? `PCGen modifications: ${mods}` : null].filter(Boolean).join('\n');
  return makeItem({
    id,
    name: (e.name.trim() || 'Item').slice(0, 120),
    quantity: Math.max(0, Math.round(e.quantity ?? 1)),
    weight: Math.max(0, e.weight ?? 0),
    value: Math.max(0, e.cost ?? 0),
    notes: notes.slice(0, 4000),
    ...detectGear(e.name, custom?.baseItem, eqmods),
  });
}

/**
 * Inventory from a .pcg build: every EQUIPNAME becomes an item, every
 * EQUIPSET a loadout (items a set doesn't place are "not carried", as in
 * PCGen), container nesting comes from the active set, and MONEY becomes
 * gold, silver and copper.
 */
export function seedInventory(build: PcgenCharacter): Inventory {
  const items = build.equipment.slice(0, 500).map((e, i) => itemFromPcg(e, `i${i + 1}`));
  const coins = build.money.amount ? coinsFromGp(build.money.amount) : emptyCoins();

  const loadouts: Loadout[] = [];
  let containerSource: { setItems: PcgenCharacter['equipmentSets'][number]['items']; byId: Map<string, string> } | null = null;
  const activeSet = build.equipmentSets.find((s) => s.id === build.activeEquipmentSetId) ?? build.equipmentSets[0];

  for (const set of build.equipmentSets.slice(0, 20)) {
    const slots: Record<string, InventorySlot> = {};
    const used = new Set<string>();
    const setItemToInv = new Map<string, string>();
    for (const si of set.items) {
      if (!si.itemName) continue;
      const targetName = (si.itemName.trim() || 'Item').slice(0, 120);
      const inv = items.find((it) => it.name === targetName && !used.has(it.id));
      if (!inv) continue;
      used.add(inv.id);
      setItemToInv.set(si.id, inv.id);
      const insideContainer = si.parentId !== null && si.parentId !== set.id;
      const loc = si.location.trim().toLowerCase();
      let slot: InventorySlot = insideContainer ? 'carried' : slotFromPcgLocation(si.location);
      // PCGen data sets file armor under Body/Torso/Equipped and shields under a hand/Equipped.
      if (!insideContainer && inv.armor?.kind === 'armor' && (slot === 'body' || slot === 'chest' || loc === 'equipped')) slot = 'armor';
      if (!insideContainer && inv.armor?.kind === 'shield' && (HAND_SLOTS.includes(slot) || loc === 'equipped')) slot = 'shield';
      slots[inv.id] = slot;
    }
    for (const it of items) if (!used.has(it.id)) slots[it.id] = 'notCarried';
    loadouts.push({ id: `l${loadouts.length + 1}`, name: (set.name.trim() || `Set ${loadouts.length + 1}`).slice(0, 60), slots });
    if (set === activeSet) containerSource = { setItems: set.items, byId: setItemToInv };
  }

  if (containerSource) {
    for (const si of containerSource.setItems) {
      const inv = containerSource.byId.get(si.id);
      const parentInv = si.parentId ? containerSource.byId.get(si.parentId) : undefined;
      const item = inv ? items.find((it) => it.id === inv) : undefined;
      const parent = parentInv ? items.find((it) => it.id === parentInv) : undefined;
      if (item && parent && parent.id !== item.id) {
        item.containerId = parent.id;
        // PCGen only nests items in containers; make sure the parent is one.
        parent.container ??= { extradimensional: false, capacity: null };
      }
    }
  }

  if (loadouts.length === 0) loadouts.push({ id: 'l1', name: 'Default', slots: {} });
  const activeIndex = activeSet ? build.equipmentSets.indexOf(activeSet) : 0;
  return { items, coins, loadouts, activeLoadoutId: loadouts[Math.min(activeIndex, loadouts.length - 1)]!.id };
}

export function activeLoadout(inv: Inventory): Loadout {
  return inv.loadouts.find((l) => l.id === inv.activeLoadoutId) ?? inv.loadouts[0]!;
}

/** An item's own slot in a loadout (ignoring containers). */
export function slotOf(loadout: Loadout, itemId: string): InventorySlot {
  return loadout.slots[itemId] ?? 'carried';
}

/** Chain of containers an item is inside, innermost first (cycle-safe). */
export function containerChain(inv: Inventory, item: InventoryItem): InventoryItem[] {
  const out: InventoryItem[] = [];
  const seen = new Set<string>([item.id]);
  let cur = item.containerId ? inv.items.find((i) => i.id === item.containerId) : undefined;
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    cur = cur.containerId ? inv.items.find((i) => i.id === cur!.containerId) : undefined;
  }
  return out;
}

/** Would putting `itemId` into `containerId` create a loop? */
export function wouldCycle(inv: Inventory, itemId: string, containerId: string): boolean {
  if (itemId === containerId) return true;
  const target = inv.items.find((i) => i.id === containerId);
  return !!target && containerChain(inv, target).some((c) => c.id === itemId);
}

/** Whether an item is with the character in a loadout (it and every container around it are carried). */
export function isCarried(inv: Inventory, loadout: Loadout, item: InventoryItem): boolean {
  if (slotOf(loadout, item.id) === 'notCarried') return false;
  return containerChain(inv, item).every((c) => slotOf(loadout, c.id) !== 'notCarried');
}

/** Equipped directly (not stowed in a container) in this slot. */
export function itemsInSlot(inv: Inventory, loadout: Loadout, slot: InventorySlot): InventoryItem[] {
  return inv.items.filter((i) => !i.containerId && slotOf(loadout, i.id) === slot && i.quantity > 0);
}

export interface LoadWeight {
  /** Pounds counted toward encumbrance. */
  total: number;
  gear: number;
  coins: number;
  /** Pounds inside extradimensional containers (not counted). */
  extradimensional: number;
}

/** Carried weight: carried items (not those inside extradimensional containers) plus coins. */
export function carriedWeight(inv: Inventory, loadout = activeLoadout(inv)): LoadWeight {
  let gear = 0;
  let extradimensional = 0;
  for (const item of inv.items) {
    if (!isCarried(inv, loadout, item)) continue;
    const w = item.weight * item.quantity;
    if (containerChain(inv, item).some((c) => c.container?.extradimensional)) extradimensional += w;
    else gear += w;
  }
  const c = inv.coins;
  const coins = (c.pp + c.gp + c.sp + c.cp) / COINS_PER_POUND;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { total: round(gear + coins), gear: round(gear), coins: round(coins), extradimensional: round(extradimensional) };
}

/** Contents weight of a container (for its capacity bar; items inside nested extradimensional containers don't weigh on outer containers). */
export function containerContentsWeight(inv: Inventory, containerId: string): number {
  let total = 0;
  for (const item of inv.items) {
    const chain = containerChain(inv, item);
    const idx = chain.findIndex((c) => c.id === containerId);
    if (idx === -1) continue;
    if (chain.slice(0, idx).some((c) => c.container?.extradimensional)) continue;
    total += item.weight * item.quantity;
  }
  return Math.round(total * 100) / 100;
}

/** The brightest lit light source the character has on them, in feet. */
export function litLight(inv: Inventory): { bright: number; dim: number; name: string } | null {
  const loadout = activeLoadout(inv);
  let best: { bright: number; dim: number; name: string } | null = null;
  for (const item of inv.items) {
    if (!item.light || !item.lit || item.quantity <= 0 || !isCarried(inv, loadout, item)) continue;
    // A light in a closed container doesn't light the room.
    if (item.containerId) continue;
    if (!best || item.light.dim > best.dim || (item.light.dim === best.dim && item.light.bright > best.bright)) best = { ...item.light, name: item.name };
  }
  return best;
}
