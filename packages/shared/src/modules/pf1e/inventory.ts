/**
 * Character inventory: items, containers, loadouts (equipment sets), the coin
 * purse, and moving items between a character and the party Loot.
 *
 * Privacy: inventory changes go to whoever can see the character. Loot
 * transfers go to everyone, because the Loot list is public; the server fills
 * in the public loot-side fields so viewers who can't see the character still
 * apply the same change. An unidentified loot item's GM-only true properties
 * never leave its loot record (which stays, `stowed`, while the item is in an
 * inventory), so the existing loot redaction keeps protecting them.
 */
import { z } from 'zod';
import type { Draft } from 'immer';
import { ActionRejection, defineAction, type AuthContext, type AuthResult } from '../../actions/define';
import { isGm } from '../../actions/auth';
import {
  CoinsSchema,
  InventoryItemSchema,
  InventorySlotSchema,
  MAX_INVENTORY_ITEMS,
  MAX_LOADOUTS,
  type Inventory,
  type InventoryItem,
  type InventorySlot,
} from '../../entities/pf1e';
import { detectGear, payFromPurse } from '../../pf1e/gear';
import { makeItem, wouldCycle } from '../../pf1e/inventory';
import { addToPurse, itemFromRecord, MATERIALS, NO_MODS, priceCp, sellValueCp, type ItemMods } from '../../rules/pricing';
import { isSourceAllowed } from '../../rules/sources';
import { IdSchema, LootItemSchema, type GameState, type User } from '../../state';
import { canManageCharacter, canSeeCharacter } from './characters';

const ItemModsSchema = z.object({
  masterwork: z.boolean().default(false),
  material: z.enum(MATERIALS).default('none'),
  enhancement: z.number().int().min(0).max(5).default(0),
});

const ItemChangesSchema = InventoryItemSchema.omit({ id: true, containerId: true, lootId: true, bonuses: true }).partial();
const LoadoutNameSchema = z.string().trim().min(1).max(60);

function requireCharacter(ctx: AuthContext, characterId: string): AuthResult {
  const c = ctx.state.characters[characterId];
  if (!c) return 'Character not found';
  return canManageCharacter(ctx.user, c) || "You don't control that character";
}

function requireItem(ctx: AuthContext, characterId: string, itemId: string): AuthResult {
  const ok = requireCharacter(ctx, characterId);
  if (ok !== true) return ok;
  return ctx.state.characters[characterId]!.inventory.items.some((i) => i.id === itemId) || 'Item not found';
}

function requireContainer(inv: Inventory, itemId: string | null, containerId: string | null): AuthResult {
  if (containerId === null) return true;
  const container = inv.items.find((i) => i.id === containerId);
  if (!container) return 'Container not found';
  if (!container.container) return `${container.name} isn't a container`;
  if (itemId && wouldCycle(inv, itemId, containerId)) return "Can't put a container inside itself";
  return true;
}

const seesCharacter = (viewer: User, characterId: string, state: GameState) => {
  const c = state.characters[characterId];
  return !!c && canSeeCharacter(viewer, c);
};

function inventoryOf(draft: Draft<GameState>, characterId: string, ts: number): Draft<Inventory> | undefined {
  const c = draft.characters[characterId];
  if (!c) return undefined;
  c.updatedAt = ts;
  return c.inventory;
}

/** Remove an item; whatever was inside it moves to where it was. */
function removeItem(inv: Draft<Inventory>, itemId: string) {
  const item = inv.items.find((i) => i.id === itemId);
  if (!item) return;
  for (const i of inv.items) if (i.containerId === itemId) i.containerId = item.containerId;
  inv.items = inv.items.filter((i) => i.id !== itemId);
  for (const l of inv.loadouts) delete l.slots[itemId];
}

/** Slots that can't be shared with `slot` (equipping evicts them to "carried"). */
function conflictingSlots(slot: InventorySlot): InventorySlot[] {
  switch (slot) {
    case 'carried':
    case 'notCarried':
    case 'ring':
      return [];
    case 'primary':
      return ['primary', 'bothHands'];
    case 'offHand':
      return ['offHand', 'bothHands'];
    case 'bothHands':
      return ['primary', 'offHand', 'bothHands'];
    default:
      return [slot];
  }
}

/** "250 gp", "2,315 gp", "12.5", "3 pp 4 sp" -> gold pieces. Non-currency text like "3 gems" returns 0. */
export function parseGpValue(text: string): number {
  const parseNum = (raw: string) =>
    Number(/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.'));
  const numPattern = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
  const trimmed = text.trim();
  const bare = new RegExp(`^${numPattern}$`).exec(trimmed);
  if (bare) {
    const n = parseNum(bare[1]!);
    return Number.isFinite(n) ? Math.min(1e9, Math.round(n * 100) / 100) : 0;
  }
  let total = 0;
  let found = false;
  for (const m of trimmed.matchAll(new RegExp(`${numPattern}\\s*(pp|gp|sp|cp)\\b`, 'gi'))) {
    const n = parseNum(m[1]!);
    if (!Number.isFinite(n)) continue;
    const unit = m[2]!.toLowerCase();
    total += unit === 'pp' ? n * 10 : unit === 'sp' ? n / 10 : unit === 'cp' ? n / 100 : n;
    found = true;
  }
  return found ? Math.min(1e9, Math.round(total * 100) / 100) : 0;
}

export const formatGpValue = (gp: number) => (gp ? `${Math.round(gp * 100) / 100} gp` : '');

export const inventoryActions = {
  addItem: defineAction('inventory/addItem', z.object({ characterId: IdSchema, item: InventoryItemSchema }), {
    authorize(ctx, { characterId, item }) {
      const ok = requireCharacter(ctx, characterId);
      if (ok !== true) return ok;
      const inv = ctx.state.characters[characterId]!.inventory;
      if (inv.items.length >= MAX_INVENTORY_ITEMS) return 'Inventory is full';
      if (inv.items.some((i) => i.id === item.id)) return 'Item already exists';
      if (item.lootId) return 'Use Take from loot for party loot';
      if (item.bonuses.length > 0) return 'Item bonuses come from the rules catalog';
      return requireContainer(inv, null, item.containerId);
    },
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, item }, meta) {
      const inv = inventoryOf(draft, characterId, meta.ts);
      if (inv && !inv.items.some((i) => i.id === item.id)) inv.items.push(item);
    },
  }),

  updateItem: defineAction('inventory/updateItem', z.object({ characterId: IdSchema, itemId: IdSchema, changes: ItemChangesSchema }), {
    authorize: (ctx, { characterId, itemId }) => requireItem(ctx, characterId, itemId),
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, itemId, changes }, meta) {
      const inv = inventoryOf(draft, characterId, meta.ts);
      const item = inv?.items.find((i) => i.id === itemId);
      if (!inv || !item) return;
      Object.assign(item, changes);
      if (item.light === null) item.lit = false;
      if (item.charges) item.charges.current = Math.min(item.charges.current, item.charges.max);
      // A container that stops being one drops its contents where it is.
      if (changes.container === null) for (const i of inv.items) if (i.containerId === itemId) i.containerId = item.containerId;
    },
  }),

  removeItem: defineAction('inventory/removeItem', z.object({ characterId: IdSchema, itemId: IdSchema }), {
    authorize: (ctx, { characterId, itemId }) => requireItem(ctx, characterId, itemId),
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, itemId }, meta) {
      const inv = inventoryOf(draft, characterId, meta.ts);
      if (inv) removeItem(inv, itemId);
    },
  }),

  /** +/- steppers for quantity (ammo, rations, potions) and charges (wands). Relative, so quick clicks don't clobber each other. */
  adjust: defineAction(
    'inventory/adjust',
    z.object({
      characterId: IdSchema,
      itemId: IdSchema,
      quantity: z.number().int().min(-1_000_000).max(1_000_000).optional(),
      charges: z.number().int().min(-10000).max(10000).optional(),
    }),
    {
      authorize(ctx, { characterId, itemId, charges }) {
        const ok = requireItem(ctx, characterId, itemId);
        if (ok !== true) return ok;
        const item = ctx.state.characters[characterId]!.inventory.items.find((i) => i.id === itemId)!;
        return charges === undefined || !!item.charges || `${item.name} has no charges`;
      },
      audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
      apply(draft, { characterId, itemId, quantity, charges }, meta) {
        const item = inventoryOf(draft, characterId, meta.ts)?.items.find((i) => i.id === itemId);
        if (!item) return;
        if (quantity) item.quantity = Math.max(0, Math.min(1_000_000, item.quantity + quantity));
        if (charges && item.charges) item.charges.current = Math.max(0, Math.min(item.charges.max, item.charges.current + charges));
      },
    },
  ),

  /** Put an item in a container (or take it out with null). Stowed items count as carried in every loadout. */
  moveItem: defineAction('inventory/moveItem', z.object({ characterId: IdSchema, itemId: IdSchema, containerId: IdSchema.nullable() }), {
    authorize(ctx, { characterId, itemId, containerId }) {
      const ok = requireItem(ctx, characterId, itemId);
      return ok === true ? requireContainer(ctx.state.characters[characterId]!.inventory, itemId, containerId) : ok;
    },
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, itemId, containerId }, meta) {
      const inv = inventoryOf(draft, characterId, meta.ts);
      const item = inv?.items.find((i) => i.id === itemId);
      if (!inv || !item) return;
      if (containerId && wouldCycle(inv as Inventory, itemId, containerId)) return;
      item.containerId = containerId;
      if (containerId) for (const l of inv.loadouts) delete l.slots[itemId];
    },
  }),

  /**
   * Equip, wield, carry or leave behind an item in a loadout (the active one by
   * default). Equipping takes the item out of its container and moves whatever
   * held that slot (or a conflicting hand slot) back to carried.
   */
  setSlot: defineAction(
    'inventory/setSlot',
    z.object({ characterId: IdSchema, itemId: IdSchema, slot: InventorySlotSchema, loadoutId: IdSchema.optional() }),
    {
      authorize(ctx, { characterId, itemId, loadoutId }) {
        const ok = requireItem(ctx, characterId, itemId);
        if (ok !== true) return ok;
        const inv = ctx.state.characters[characterId]!.inventory;
        return !loadoutId || inv.loadouts.some((l) => l.id === loadoutId) || 'Loadout not found';
      },
      audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
      apply(draft, { characterId, itemId, slot, loadoutId }, meta) {
        const inv = inventoryOf(draft, characterId, meta.ts);
        const item = inv?.items.find((i) => i.id === itemId);
        if (!inv || !item) return;
        const loadout = inv.loadouts.find((l) => l.id === (loadoutId ?? inv.activeLoadoutId)) ?? inv.loadouts[0]!;
        const equipping = slot !== 'carried' && slot !== 'notCarried';
        if (equipping || slot === 'notCarried') item.containerId = null;
        const conflicts = conflictingSlots(slot);
        if (slot === 'ring') {
          const rings = inv.items.filter((i) => i.id !== itemId && !i.containerId && loadout.slots[i.id] === 'ring');
          if (rings.length >= 2) loadout.slots[rings[0]!.id] = 'carried';
        }
        for (const other of inv.items) {
          if (other.id !== itemId && !other.containerId && conflicts.includes(loadout.slots[other.id] ?? 'carried')) loadout.slots[other.id] = 'carried';
        }
        loadout.slots[itemId] = slot;
      },
    },
  ),

  /** Light or put out a torch/lantern (the client then syncs the linked token's light). */
  setLit: defineAction('inventory/setLit', z.object({ characterId: IdSchema, itemId: IdSchema, lit: z.boolean() }), {
    authorize(ctx, { characterId, itemId }) {
      const ok = requireItem(ctx, characterId, itemId);
      if (ok !== true) return ok;
      const item = ctx.state.characters[characterId]!.inventory.items.find((i) => i.id === itemId)!;
      return !!item.light || `${item.name} isn't a light source`;
    },
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, itemId, lit }, meta) {
      const item = inventoryOf(draft, characterId, meta.ts)?.items.find((i) => i.id === itemId);
      if (item) item.lit = lit;
    },
  }),

  setCoins: defineAction('inventory/setCoins', z.object({ characterId: IdSchema, coins: CoinsSchema }), {
    authorize: (ctx, { characterId }) => requireCharacter(ctx, characterId),
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, coins }, meta) {
      const inv = inventoryOf(draft, characterId, meta.ts);
      if (inv) inv.coins = coins;
    },
  }),

  // ---------------------------------------------------------------- loadouts

  createLoadout: defineAction(
    'inventory/createLoadout',
    z.object({ characterId: IdSchema, loadoutId: IdSchema, name: LoadoutNameSchema, copyFrom: IdSchema.optional() }),
    {
      authorize(ctx, { characterId, loadoutId, copyFrom }) {
        const ok = requireCharacter(ctx, characterId);
        if (ok !== true) return ok;
        const inv = ctx.state.characters[characterId]!.inventory;
        if (inv.loadouts.length >= MAX_LOADOUTS) return `At most ${MAX_LOADOUTS} loadouts`;
        if (inv.loadouts.some((l) => l.id === loadoutId)) return 'Loadout already exists';
        return !copyFrom || inv.loadouts.some((l) => l.id === copyFrom) || 'Loadout not found';
      },
      audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
      apply(draft, { characterId, loadoutId, name, copyFrom }, meta) {
        const inv = inventoryOf(draft, characterId, meta.ts);
        if (!inv || inv.loadouts.some((l) => l.id === loadoutId)) return;
        const source = copyFrom ? inv.loadouts.find((l) => l.id === copyFrom) : undefined;
        inv.loadouts.push({ id: loadoutId, name, slots: source ? { ...source.slots } : {} });
        inv.activeLoadoutId = loadoutId;
      },
    },
  ),

  renameLoadout: defineAction('inventory/renameLoadout', z.object({ characterId: IdSchema, loadoutId: IdSchema, name: LoadoutNameSchema }), {
    authorize(ctx, { characterId, loadoutId }) {
      const ok = requireCharacter(ctx, characterId);
      return ok === true ? ctx.state.characters[characterId]!.inventory.loadouts.some((l) => l.id === loadoutId) || 'Loadout not found' : ok;
    },
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, loadoutId, name }, meta) {
      const l = inventoryOf(draft, characterId, meta.ts)?.loadouts.find((x) => x.id === loadoutId);
      if (l) l.name = name;
    },
  }),

  deleteLoadout: defineAction('inventory/deleteLoadout', z.object({ characterId: IdSchema, loadoutId: IdSchema }), {
    authorize(ctx, { characterId, loadoutId }) {
      const ok = requireCharacter(ctx, characterId);
      if (ok !== true) return ok;
      const inv = ctx.state.characters[characterId]!.inventory;
      if (!inv.loadouts.some((l) => l.id === loadoutId)) return 'Loadout not found';
      return inv.loadouts.length > 1 || 'Keep at least one loadout';
    },
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, loadoutId }, meta) {
      const inv = inventoryOf(draft, characterId, meta.ts);
      if (!inv || inv.loadouts.length <= 1) return;
      inv.loadouts = inv.loadouts.filter((l) => l.id !== loadoutId);
      if (inv.activeLoadoutId === loadoutId) inv.activeLoadoutId = inv.loadouts[0]!.id;
    },
  }),

  /** Switch equipment sets in one click (e.g. "Drop backpack" when a fight starts). */
  setActiveLoadout: defineAction('inventory/setActiveLoadout', z.object({ characterId: IdSchema, loadoutId: IdSchema }), {
    authorize(ctx, { characterId, loadoutId }) {
      const ok = requireCharacter(ctx, characterId);
      return ok === true ? ctx.state.characters[characterId]!.inventory.loadouts.some((l) => l.id === loadoutId) || 'Loadout not found' : ok;
    },
    audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
    apply(draft, { characterId, loadoutId }, meta) {
      const inv = inventoryOf(draft, characterId, meta.ts);
      if (inv && inv.loadouts.some((l) => l.id === loadoutId)) inv.activeLoadoutId = loadoutId;
    },
  }),

  // ---------------------------------------------------------------- party loot

  /**
   * Take some or all of a party loot item into a character's inventory. The
   * loot record stays (hidden as `stowed` once empty) so an unidentified item
   * keeps its GM-only true properties there.
   */
  takeLoot: defineAction(
    'inventory/takeLoot',
    z.object({ lootId: IdSchema, characterId: IdSchema, itemId: IdSchema, quantity: z.number().int().min(1).max(1_000_000) }),
    {
      authorize(ctx, { lootId, characterId, itemId, quantity }) {
        const ok = requireCharacter(ctx, characterId);
        if (ok !== true) return ok;
        const loot = ctx.state.loot[lootId];
        if (!loot || loot.stowed) return 'Loot item not found';
        if (loot.quantity <= 0) return 'None left';
        if (quantity > loot.quantity) return `Only ${loot.quantity} left`;
        const inv = ctx.state.characters[characterId]!.inventory;
        if (inv.items.length >= MAX_INVENTORY_ITEMS) return 'Inventory is full';
        return !inv.items.some((i) => i.id === itemId) || 'Item already exists';
      },
      // Everyone: the Loot list changes. Viewers who can't see the character skip the inventory half.
      apply(draft, { lootId, characterId, itemId, quantity }, meta) {
        const loot = draft.loot[lootId];
        if (!loot || loot.stowed) return;
        const inv = inventoryOf(draft, characterId, meta.ts);
        if (inv && !inv.items.some((i) => i.id === itemId)) {
          inv.items.push(
            makeItem({
              id: itemId,
              name: loot.name,
              quantity,
              value: parseGpValue(loot.value),
              notes: loot.notes.slice(0, 4000),
              imageUrl: loot.imageUrl,
              lootId,
              ...detectGear(loot.name),
            }),
          );
        }
        loot.quantity = Math.max(0, loot.quantity - quantity);
        if (loot.quantity === 0) loot.stowed = true;
      },
    },
  ),

  /**
   * Put some or all of an inventory item into the party loot: back onto the
   * loot record it came from, or onto a new one. The server fills in the loot
   * side so everyone applies the same change.
   */
  giveToLoot: defineAction(
    'inventory/giveToLoot',
    z.object({
      characterId: IdSchema,
      itemId: IdSchema,
      quantity: z.number().int().min(1).max(1_000_000),
      /** Id for a new loot record (used when the item didn't come from loot). */
      newLootId: IdSchema,
      /** Filled in by the server. */
      loot: LootItemSchema.pick({ name: true, imageUrl: true, value: true, notes: true }).extend({ lootId: IdSchema, wholeStack: z.boolean() }).optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, { characterId, itemId, quantity, newLootId }) {
        const ok = requireItem(ctx, characterId, itemId);
        if (ok !== true) return ok;
        const item = ctx.state.characters[characterId]!.inventory.items.find((i) => i.id === itemId)!;
        if (item.quantity <= 0) return 'None in the inventory';
        if (quantity > item.quantity) return `Only ${item.quantity} in the inventory`;
        const existing = item.lootId ? ctx.state.loot[item.lootId] : undefined;
        return !!existing || !ctx.state.loot[newLootId] || 'Loot item already exists';
      },
      prepare(ctx, payload) {
        const item = ctx.state.characters[payload.characterId]!.inventory.items.find((i) => i.id === payload.itemId)!;
        const existing = item.lootId && ctx.state.loot[item.lootId] ? item.lootId : null;
        return {
          ...payload,
          loot: {
            lootId: existing ?? payload.newLootId,
            name: item.name,
            imageUrl: item.imageUrl,
            value: formatGpValue(item.value).slice(0, 60),
            notes: item.notes,
            wholeStack: payload.quantity >= item.quantity,
          },
        };
      },
      apply(draft, { characterId, itemId, quantity, loot }, meta) {
        if (!loot) return;
        const record = draft.loot[loot.lootId];
        if (record) {
          const wasStowed = record.stowed;
          record.quantity = Math.min(1_000_000, (wasStowed ? 0 : record.quantity) + quantity);
          record.stowed = false;
          if (wasStowed && loot.wholeStack) Object.assign(record, { name: loot.name, notes: loot.notes });
        } else {
          draft.loot[loot.lootId] = {
            id: loot.lootId,
            name: loot.name,
            imageUrl: loot.imageUrl,
            quantity,
            value: loot.value,
            holderId: null,
            notes: loot.notes,
            // The character's own gear: nothing secret to identify.
            identified: true,
            secretNotes: '',
            stowed: false,
            trueName: '',
            secretValue: '',
            cl: null,
            magicDetected: false,
            createdBy: meta.userId,
            createdAt: meta.ts,
          };
        }
        const inv = inventoryOf(draft, characterId, meta.ts);
        const item = inv?.items.find((i) => i.id === itemId);
        if (!inv || !item) return;
        item.quantity = Math.max(0, item.quantity - quantity);
        if (item.quantity === 0) removeItem(inv, itemId);
      },
    },
  ),

  // ---------------------------------------------------------------- shopping (Epic 11)

  /**
   * Buy an item from the rules catalog (or a custom rule) into a character's
   * inventory, paying from the character's purse with automatic change.
   * Server-computed in `prepare()` so prices and allowed books cannot be faked.
   */
  buyItem: defineAction(
    'inventory/buyItem',
    z.object({
      characterId: IdSchema,
      itemId: IdSchema,
      quantity: z.number().int().min(1).max(10000),
      /** Rules-pack equipment KEY. */
      ruleKey: z.string().min(1).max(160).optional(),
      /** Custom room rule id (when buying an AoN/homebrew item). */
      customRuleId: IdSchema.optional(),
      mods: ItemModsSchema.optional(),
      /** Filled in by the server; ignored from clients. */
      item: InventoryItemSchema.optional(),
      nextCoins: CoinsSchema.optional(),
      totalCp: z.number().int().min(0).optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, { characterId, itemId, ruleKey, customRuleId }) {
        const ok = requireCharacter(ctx, characterId);
        if (ok !== true) return ok;
        if (!ruleKey && !customRuleId) return 'Choose a catalog item to buy';
        const inv = ctx.state.characters[characterId]!.inventory;
        if (inv.items.length >= MAX_INVENTORY_ITEMS) return 'Inventory is full';
        if (inv.items.some((i) => i.id === itemId)) return 'Item already exists';
        if (customRuleId) {
          const cr = ctx.state.customRules[customRuleId];
          if (!cr || cr.kind !== 'equipment') return 'Custom item not found';
          if (cr.gmOnly && !isGm(ctx.user)) return 'Custom item not found';
          if (cr.cost === null) return `${cr.name} has no price`;
        }
        return true;
      },
      prepare(ctx, p) {
        const inv = ctx.state.characters[p.characterId]!.inventory;
        let built: InventoryItem;
        if (p.customRuleId) {
          const cr = ctx.state.customRules[p.customRuleId]!;
          const detected = detectGear(cr.name);
          built = makeItem({
            id: p.itemId,
            name: cr.name.slice(0, 120),
            quantity: p.quantity,
            weight: cr.weight ?? 0,
            value: cr.cost ?? 0,
            notes: cr.text.slice(0, 4000),
            weapon: cr.weapon ?? detected.weapon,
            armor: cr.armor ?? detected.armor,
            light: detected.light,
            container: detected.container,
            charges: detected.charges,
            ruleKey: `custom:${cr.id}`.slice(0, 120),
          });
        } else {
          const rec = ctx.rules?.get('equipment', p.ruleKey!);
          if (!rec) throw new ActionRejection('Item not found in the server rules pack');
          if (!isGm(ctx.user) && !isSourceAllowed(ctx.state.rules.allowedSources, rec.source.campaign)) {
            throw new ActionRejection(`${rec.name} is from "${rec.source.long}", which isn't allowed in this campaign`);
          }
          const mods: ItemMods = p.mods ? { masterwork: p.mods.masterwork, material: p.mods.material, enhancement: p.mods.enhancement } : NO_MODS;
          const res = itemFromRecord(rec, p.itemId, mods, p.quantity);
          if (typeof res === 'string') throw new ActionRejection(res);
          built = res;
        }
        const totalCp = priceCp(built.value, p.quantity);
        const nextCoins = payFromPurse(inv.coins, totalCp);
        if (!nextCoins) throw new ActionRejection(`Not enough coin (needs ${Math.round(totalCp) / 100} gp)`);
        return {
          characterId: p.characterId,
          itemId: p.itemId,
          quantity: p.quantity,
          ...(p.ruleKey ? { ruleKey: p.ruleKey } : {}),
          ...(p.customRuleId ? { customRuleId: p.customRuleId } : {}),
          ...(p.mods ? { mods: p.mods } : {}),
          item: built,
          nextCoins,
          totalCp,
        };
      },
      audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
      apply(draft, { characterId, item, nextCoins }, meta) {
        if (!item || !nextCoins) return;
        const inv = inventoryOf(draft, characterId, meta.ts);
        if (!inv || inv.items.some((i) => i.id === item.id)) return;
        inv.items.push(item);
        inv.coins = nextCoins;
      },
    },
  ),

  /**
   * Sell some or all of an inventory item at half value (full value for gems,
   * art objects and trade goods), crediting the character's purse atomically.
   */
  sellItem: defineAction(
    'inventory/sellItem',
    z.object({
      characterId: IdSchema,
      itemId: IdSchema,
      quantity: z.number().int().min(1).max(1_000_000),
      /** Filled in by the server; ignored from clients. */
      nextCoins: CoinsSchema.optional(),
      payoutCp: z.number().int().min(0).optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, { characterId, itemId, quantity }) {
        const ok = requireItem(ctx, characterId, itemId);
        if (ok !== true) return ok;
        const item = ctx.state.characters[characterId]!.inventory.items.find((i) => i.id === itemId)!;
        if (isUnidentifiedLoot(ctx.state, item)) return 'Identify this item before selling it';
        if (item.quantity <= 0) return 'None left to sell';
        if (quantity > item.quantity) return `Only ${item.quantity} in the inventory`;
        return true;
      },
      prepare(ctx, { characterId, itemId, quantity }) {
        const inv = ctx.state.characters[characterId]!.inventory;
        const item = inv.items.find((i) => i.id === itemId)!;
        const payoutCp = sellValueCp(item, quantity);
        return { characterId, itemId, quantity, payoutCp, nextCoins: addToPurse(inv.coins, payoutCp) };
      },
      audience: (viewer, { characterId }, { state }) => seesCharacter(viewer, characterId, state),
      apply(draft, { characterId, itemId, quantity, nextCoins }, meta) {
        if (!nextCoins) return;
        const inv = inventoryOf(draft, characterId, meta.ts);
        const item = inv?.items.find((i) => i.id === itemId);
        if (!inv || !item) return;
        item.quantity = Math.max(0, item.quantity - quantity);
        if (item.quantity === 0) removeItem(inv, itemId);
        inv.coins = nextCoins;
      },
    },
  ),
};

/** An item that came from party loot and hasn't been identified yet (its true properties stay GM-only). */
export function isUnidentifiedLoot(state: Pick<GameState, 'loot'>, item: InventoryItem): boolean {
  const loot = item.lootId ? state.loot[item.lootId] : undefined;
  return !!loot && !loot.identified;
}
