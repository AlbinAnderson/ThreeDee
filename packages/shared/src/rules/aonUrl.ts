/**
 * Archives of Nethys (aonprd.com, PF1e) deep links built from a name, with no
 * fetching. AoN pages are `<Type>Display.aspx?ItemName=<name>`; the page type
 * depends on what the thing is.
 */

export const AON_ORIGIN = 'https://www.aonprd.com';
export const AON_HOSTS = ['aonprd.com', 'www.aonprd.com'] as const;

export type AonKind =
  | 'spell'
  | 'feat'
  | 'trait'
  | 'weapon'
  | 'armor'
  | 'equipment'
  | 'magicWeapon'
  | 'magicArmor'
  | 'wondrous'
  | 'ring'
  | 'rod'
  | 'staff'
  | 'deity'
  | 'domain'
  | 'class'
  | 'race'
  | 'monster'
  | 'search';

/** Page for each kind (Verify in audit: magic rings/wondrous/rods also accept FinalName=). */
export const AON_PAGES: Record<Exclude<AonKind, 'search'>, string> = {
  spell: 'SpellDisplay.aspx',
  feat: 'FeatDisplay.aspx',
  trait: 'TraitDisplay.aspx',
  weapon: 'EquipmentWeaponsDisplay.aspx',
  armor: 'EquipmentArmorDisplay.aspx',
  equipment: 'EquipmentMiscDisplay.aspx',
  magicWeapon: 'MagicWeaponsDisplay.aspx',
  magicArmor: 'MagicArmorDisplay.aspx',
  wondrous: 'MagicWondrousDisplay.aspx',
  ring: 'MagicRingsDisplay.aspx',
  rod: 'MagicRodsDisplay.aspx',
  staff: 'MagicStavesDisplay.aspx',
  deity: 'DeityDisplay.aspx',
  domain: 'DomainDisplay.aspx',
  class: 'ClassDisplay.aspx',
  race: 'RacesDisplay.aspx',
  monster: 'MonsterDisplay.aspx',
};

const VARIANT_WORDS = /^(greater|lesser|mass|communal|improved|mythic)$/i;

/**
 * PCGen display name -> the name AoN uses:
 *  - "Trait ~ Reactionary" / "Fighter ~ Bravery" -> the part after "~"
 *  - "Longsword (Base)" -> "Longsword"
 *  - "Invisibility (Greater)" -> "Invisibility, Greater" (AoN's comma form)
 */
export function aonName(name: string): string {
  let n = name.trim();
  const tilde = n.lastIndexOf('~');
  if (tilde !== -1) n = n.slice(tilde + 1).trim();
  n = n.replace(/\s*\(base\)\s*$/i, '');
  const m = /^(.+?)\s*\(([^()]+)\)$/.exec(n);
  if (m && VARIANT_WORDS.test(m[2]!.trim())) n = `${m[1]!.trim()}, ${m[2]!.trim()}`;
  return n.replace(/\s+/g, ' ').slice(0, 200);
}

/** https://www.aonprd.com/SpellDisplay.aspx?ItemName=Fireball */
export function aonUrl(kind: AonKind, name: string): string {
  const item = encodeURIComponent(aonName(name));
  if (kind === 'search') return `${AON_ORIGIN}/Search.aspx?Query=${item}`;
  return `${AON_ORIGIN}/${AON_PAGES[kind]}?ItemName=${item}`;
}

/** The AoN page kind for a rules-pack equipment record, from its PCGen types. */
export function aonEquipmentKind(types: readonly string[]): AonKind {
  const t = new Set(types.map((x) => x.toLowerCase()));
  const magic = t.has('magic');
  if (t.has('ring')) return 'ring';
  if (t.has('rod')) return 'rod';
  if (t.has('staff') && magic) return 'staff';
  if (t.has('weapon')) return magic ? 'magicWeapon' : 'weapon';
  if (t.has('armor') || t.has('shield')) return magic ? 'magicArmor' : 'armor';
  if (magic && (t.has('wondrous') || t.has('potion') || t.has('scroll') || t.has('wand'))) return 'wondrous';
  return magic ? 'wondrous' : 'equipment';
}

/**
 * A strict, allowlisted AoN URL: https on aonprd.com / www.aonprd.com, a
 * `*Display.aspx` page with an ItemName/FinalName query. Anything else
 * (other hosts, ports, credentials, schemes, paths) returns null.
 */
export function normalizeAonUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (!(AON_HOSTS as readonly string[]).includes(u.hostname.toLowerCase())) return null;
  if (u.username || u.password || u.port) return null;
  if (!/^\/[A-Za-z]+Display\.aspx$/.test(u.pathname)) return null;
  const item = u.searchParams.get('ItemName') ?? u.searchParams.get('FinalName');
  if (!item || item.length > 200) return null;
  const param = u.searchParams.has('ItemName') ? 'ItemName' : 'FinalName';
  return `${AON_ORIGIN}${u.pathname}?${param}=${encodeURIComponent(item)}`;
}

/** The kind of page an allowlisted AoN URL points at (what parser to use). */
export function aonPageKind(url: string): 'monster' | 'spell' | 'feat' | 'item' | 'other' {
  const path = new URL(url).pathname.toLowerCase();
  if (path === '/monsterdisplay.aspx' || path === '/npcdisplay.aspx') return 'monster';
  if (path === '/spelldisplay.aspx') return 'spell';
  if (path === '/featdisplay.aspx' || path === '/traitdisplay.aspx') return 'feat';
  if (path.startsWith('/equipment') || path.startsWith('/magic')) return 'item';
  return 'other';
}
