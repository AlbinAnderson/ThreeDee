/**
 * Parser for native PCGen (.pcg) character save files (PCGVERSION 2.0, PCGen 5.x/6.x).
 *
 * Pure TypeScript with no Node-only APIs so it runs identically in the browser
 * (UI import) and on the server / CLI.
 */
import {
  PCGEN_JSON_FORMAT,
  PCGEN_JSON_VERSION,
  PcgenCharacterSchema,
  type PcgenAbility,
  type PcgenAppliedTemplate,
  type PcgenCharacter,
  type PcgenClass,
  type PcgenClassLevel,
  type PcgenCompanionRef,
  type PcgenDeity,
  type PcgenDomain,
  type PcgenEquipmentCustomization,
  type PcgenEquipmentItem,
  type PcgenEquipmentSet,
  type PcgenEquipmentSetItem,
  type PcgenKit,
  type PcgenNote,
  type PcgenRawLine,
  type PcgenSkill,
  type PcgenSkillClassBought,
  type PcgenSpellBook,
  type PcgenSpellEntry,
  type PcgenSpellList,
  type PcgenTempBonus,
  type PcgenToken,
} from './schema';
import { parseCustomizationData, parseLine, parseToken } from './tokenize';

const ABILITY_NATURES = new Set(['NORMAL', 'AUTOMATIC', 'VIRTUAL']);

const BOOLEAN_SYSTEM_SETTINGS = new Set([
  'AUTOSPELLS',
  'USEHIGHERKNOWN',
  'USEHIGHERPREPPED',
  'LOADCOMPANIONS',
  'USETEMPMODS',
  'AUTOSORTGEAR',
  'IGNORECOST',
  'ALLOWDEBT',
  'AUTORESIZEGEAR',
]);

const NUMERIC_SYSTEM_SETTINGS = new Set(['SKILLSOUTPUTORDER', 'SKILLFILTER']);

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseIntStrict(raw: string | undefined): number | null {
  const n = parseNumber(raw);
  return n !== null && Number.isInteger(n) ? n : null;
}

function parseBool(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'Y' || upper === 'YES' || upper === 'TRUE' || upper === '1') return true;
  if (upper === 'N' || upper === 'NO' || upper === 'FALSE' || upper === '0') return false;
  return null;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.length > 0 ? value : null;
}

function createEmptyCharacter(): PcgenCharacter {
  return {
    format: PCGEN_JSON_FORMAT,
    schemaVersion: PCGEN_JSON_VERSION,
    system: {
      pcgVersion: null,
      pcgenVersion: null,
      gameMode: null,
      characterType: null,
      campaigns: [],
      rollMethod: null,
      purchasePoints: null,
      previewSheet: null,
      tabLabel: null,
      poolPoints: null,
      poolPointsAvail: null,
      settings: {},
    },
    bio: {
      name: null,
      tabName: null,
      playerName: null,
      gender: null,
      handed: null,
      age: null,
      ageSet: null,
      height: null,
      weight: null,
      skinColor: null,
      eyeColor: null,
      hairColor: null,
      hairStyle: null,
      location: null,
      city: null,
      birthday: null,
      birthplace: null,
      personalityTrait1: null,
      personalityTrait2: null,
      speechPattern: null,
      phobias: null,
      interests: null,
      catchPhrase: null,
      portrait: null,
      portraitThumbnailRect: null,
      description: null,
      biography: null,
      companions: null,
      assets: null,
      magic: null,
      dmNotes: null,
      suppressBioFields: [],
    },
    attributes: {
      stats: {},
      alignment: null,
      race: null,
      favoredClasses: [],
      region: null,
      templates: [],
      appliedTemplates: [],
      deity: null,
      domains: [],
      languages: [],
      weaponProficiencies: [],
    },
    experience: {
      xp: null,
      table: null,
    },
    money: {
      amount: null,
      raw: null,
    },
    classes: [],
    classLevels: [],
    skills: [],
    abilities: [],
    legacyFeats: [],
    virtualFeats: [],
    abilityPools: {},
    equipment: [],
    equipmentSets: [],
    activeEquipmentSetId: null,
    spells: {
      spellBooks: [],
      spellLists: [],
      entries: [],
    },
    tempBonuses: [],
    notes: [],
    companions: {
      masters: [],
      followers: [],
    },
    kits: [],
    chronicleEntries: [],
    warnings: [],
    unknownLines: [],
  };
}

function pushUnique(target: string[], value: string) {
  if (value && !target.includes(value)) target.push(value);
}

function collectRepeatedValues(tokens: PcgenToken[], expectedTag: string): { values: string[]; extra: PcgenToken[] } {
  const values: string[] = [];
  const extra: PcgenToken[] = [];
  for (const tok of tokens) {
    if (tok.tag === expectedTag) {
      if (tok.value) values.push(tok.value);
    } else {
      extra.push(tok);
    }
  }
  return { values, extra };
}

function parseDeity(line: PcgenRawLine): PcgenDeity {
  const first = line.tokens[0]!;
  const deity: PcgenDeity = {
    name: first.value,
    alignment: null,
    allowedAlignments: null,
    domains: [],
    favoredWeapons: [],
    holyItem: null,
    description: null,
    symbol: null,
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'DEITYALIGN':
        deity.alignment = nonEmpty(tok.value);
        break;
      case 'ALIGNALLOW':
        deity.allowedAlignments = nonEmpty(tok.value);
        break;
      case 'HOLYITEM':
        deity.holyItem = nonEmpty(tok.value);
        break;
      case 'DESC':
        deity.description = nonEmpty(tok.value);
        break;
      case 'SYMBOL':
        deity.symbol = nonEmpty(tok.value);
        break;
      case 'DEITYDOMAINS':
        if (tok.subTokens) {
          for (const sub of tok.subTokens) {
            if (sub.value) deity.domains.push(sub.value);
          }
        } else if (tok.value) {
          deity.domains.push(...tok.value.split(',').map((s) => s.trim()).filter(Boolean));
        }
        break;
      case 'DEITYFAVWEAP':
        if (tok.subTokens) {
          for (const sub of tok.subTokens) {
            if (sub.value) deity.favoredWeapons.push(sub.value);
          }
        } else if (tok.value) {
          deity.favoredWeapons.push(...tok.value.split(',').map((s) => s.trim()).filter(Boolean));
        }
        break;
      default:
        deity.extra.push(tok);
        break;
    }
  }

  return deity;
}

function parseSourceToken(tok: PcgenToken): Record<string, string> | null {
  if (tok.subTokens && tok.subTokens.length > 0) {
    const src: Record<string, string> = {};
    for (const sub of tok.subTokens) {
      if (sub.tag) src[sub.tag] = sub.value;
    }
    return src;
  }
  return tok.value ? { raw: tok.value } : null;
}

function parseDomain(line: PcgenRawLine): PcgenDomain {
  const first = line.tokens[0]!;
  const domain: PcgenDomain = {
    name: first.value,
    grants: null,
    source: null,
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    if (tok.tag === 'SOURCE') {
      domain.source = parseSourceToken(tok);
    } else if (tok.tag === 'DOMAINGRANTS') {
      domain.grants = nonEmpty(tok.value);
    } else {
      domain.extra.push(tok);
    }
  }

  return domain;
}

function parseAppliedTemplate(tok: PcgenToken): PcgenAppliedTemplate {
  const tpl: PcgenAppliedTemplate = {
    name: '',
    chosenTemplates: [],
    extra: [],
  };

  if (!tok.subTokens) {
    tpl.name = tok.value;
    return tpl;
  }

  for (const sub of tok.subTokens) {
    if (sub.tag === 'NAME') {
      tpl.name = sub.value;
    } else if (sub.tag === 'CHOSENTEMPLATE') {
      const nameTok = sub.subTokens?.find((t) => t.tag === 'NAME');
      const chosen = nameTok?.value ?? sub.value;
      if (chosen) tpl.chosenTemplates.push(chosen);
    } else {
      tpl.extra.push(sub);
    }
  }

  return tpl;
}

function parseClass(line: PcgenRawLine, warnings: string[]): PcgenClass {
  const first = line.tokens[0]!;
  const cls: PcgenClass = {
    name: first.value,
    level: 0,
    subClass: null,
    skillPool: null,
    spellBase: null,
    canCastPerDay: null,
    specialty: null,
    prohibited: [],
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'LEVEL': {
        const lvl = parseIntStrict(tok.value);
        if (lvl !== null) cls.level = lvl;
        else warnings.push(`Line ${line.lineNumber}: invalid CLASS LEVEL "${tok.value}"`);
        break;
      }
      case 'SUBCLASS':
        cls.subClass = nonEmpty(tok.value);
        break;
      case 'SKILLPOOL':
        cls.skillPool = parseNumber(tok.value);
        break;
      case 'SPELLBASE':
        cls.spellBase = nonEmpty(tok.value);
        break;
      case 'CANCASTPERDAY':
        cls.canCastPerDay = nonEmpty(tok.value);
        break;
      case 'SPECIALTY':
        cls.specialty = nonEmpty(tok.value);
        break;
      case 'PROHIBITED':
        for (const school of tok.value.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (school.toLowerCase() !== 'none') pushUnique(cls.prohibited, school);
        }
        break;
      default:
        cls.extra.push(tok);
        break;
    }
  }

  return cls;
}

function parseClassLevel(line: PcgenRawLine, warnings: string[]): PcgenClassLevel {
  const first = line.tokens[0]!;
  const eqIdx = first.value.lastIndexOf('=');
  let className = first.value;
  let level = 0;

  if (eqIdx !== -1) {
    className = first.value.slice(0, eqIdx);
    const parsedLevel = parseIntStrict(first.value.slice(eqIdx + 1));
    if (parsedLevel !== null) {
      level = parsedLevel;
    } else {
      warnings.push(`Line ${line.lineNumber}: invalid CLASSABILITIESLEVEL "${first.value}"`);
    }
  }

  const entry: PcgenClassLevel = {
    className,
    level,
    hitPoints: null,
    skillsGained: null,
    skillsRemaining: null,
    specialties: [],
    statIncreases: {},
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'HITPOINTS':
        entry.hitPoints = parseNumber(tok.value);
        break;
      case 'SKILLSGAINED':
      case 'SKILLPOINTSGAINED':
        entry.skillsGained = parseNumber(tok.value);
        break;
      case 'SKILLSREMAINING':
      case 'SKILLPOINTSREMAINING':
        entry.skillsRemaining = parseNumber(tok.value);
        break;
      case 'SPECIALTIES':
        if (tok.subTokens) {
          for (const sub of tok.subTokens) {
            if (sub.value) pushUnique(entry.specialties, sub.value);
          }
        } else if (tok.value) {
          pushUnique(entry.specialties, tok.value);
        }
        break;
      case 'STAT':
      case 'PRESTAT': {
        const statEq = tok.value.indexOf('=');
        if (statEq !== -1) {
          const statName = tok.value.slice(0, statEq).trim();
          const delta = parseNumber(tok.value.slice(statEq + 1));
          if (statName && delta !== null) {
            entry.statIncreases[statName] = (entry.statIncreases[statName] ?? 0) + delta;
            break;
          }
        }
        entry.extra.push(tok);
        break;
      }
      default:
        entry.extra.push(tok);
        break;
    }
  }

  return entry;
}

function parseClassBought(tok: PcgenToken): PcgenSkillClassBought {
  const cb: PcgenSkillClassBought = {
    className: '',
    ranks: 0,
    cost: null,
    classSkill: null,
    extra: [],
  };

  for (const sub of tok.subTokens ?? []) {
    switch (sub.tag) {
      case 'CLASS':
        cb.className = sub.value;
        break;
      case 'RANKS':
        cb.ranks = parseNumber(sub.value) ?? 0;
        break;
      case 'COST':
        cb.cost = parseNumber(sub.value);
        break;
      case 'CLASSSKILL':
        cb.classSkill = parseBool(sub.value);
        break;
      default:
        cb.extra.push(sub);
        break;
    }
  }

  return cb;
}

function parseSkill(line: PcgenRawLine): PcgenSkill {
  const first = line.tokens[0]!;
  const skill: PcgenSkill = {
    name: first.value,
    outputOrder: null,
    totalRanks: 0,
    classBought: [],
    synergy: null,
    associatedData: [],
    extra: [],
  };

  let directRanks: number | null = null;

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'OUTPUTORDER':
        skill.outputOrder = parseIntStrict(tok.value);
        break;
      case 'CLASSBOUGHT':
        skill.classBought.push(parseClassBought(tok));
        break;
      case 'RANKS':
        directRanks = parseNumber(tok.value);
        break;
      case 'SYNERGY':
        skill.synergy = nonEmpty(tok.value);
        break;
      case 'ASSOCIATEDDATA':
        if (tok.value) skill.associatedData.push(tok.value);
        break;
      default:
        // PCGen writes a trailing `|` on unranked skills (e.g. `SKILL:Acrobatics|OUTPUTORDER:1|`)
        if (tok.tag === '' && tok.value === '') break;
        skill.extra.push(tok);
        break;
    }
  }

  if (skill.classBought.length > 0) {
    skill.totalRanks = skill.classBought.reduce((sum, cb) => sum + cb.ranks, 0);
  } else if (directRanks !== null) {
    skill.totalRanks = directRanks;
  }

  return skill;
}

function parseAbility(line: PcgenRawLine): PcgenAbility {
  const first = line.tokens[0]!;
  const ability: PcgenAbility = {
    pool: first.value,
    category: first.value,
    key: '',
    nature: null,
    types: [],
    appliedTo: [],
    description: null,
    cost: null,
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'CATEGORY':
        if (tok.value) ability.category = tok.value;
        break;
      case 'KEY':
        ability.key = tok.value;
        break;
      case 'TYPE': {
        const upper = tok.value.trim().toUpperCase();
        if (ability.nature === null && ABILITY_NATURES.has(upper)) {
          ability.nature = upper;
        } else {
          for (const part of tok.value.split('.').map((s) => s.trim()).filter(Boolean)) {
            pushUnique(ability.types, part);
          }
        }
        break;
      }
      case 'APPLIEDTO':
        if (tok.value.length > 0) {
          ability.appliedTo.push(...tok.value.split(','));
        }
        break;
      case 'DESC':
        ability.description = nonEmpty(tok.value);
        break;
      case 'COST':
        ability.cost = parseNumber(tok.value);
        break;
      default:
        ability.extra.push(tok);
        break;
    }
  }

  return ability;
}

function parseCustomization(tok: PcgenToken): PcgenEquipmentCustomization {
  const custom: PcgenEquipmentCustomization = {
    baseItem: null,
    rawData: null,
    data: {},
    extra: [],
  };

  if (!tok.subTokens) {
    custom.rawData = nonEmpty(tok.value);
    custom.data = parseCustomizationData(tok.value);
    return custom;
  }

  for (const sub of tok.subTokens) {
    switch (sub.tag) {
      case 'BASEITEM':
        custom.baseItem = nonEmpty(sub.value);
        break;
      case 'DATA':
        custom.rawData = nonEmpty(sub.value);
        custom.data = parseCustomizationData(sub.value);
        break;
      default:
        custom.extra.push(sub);
        break;
    }
  }

  return custom;
}

function parseEquipmentItem(line: PcgenRawLine): PcgenEquipmentItem {
  const first = line.tokens[0]!;
  const item: PcgenEquipmentItem = {
    name: first.value,
    outputOrder: null,
    cost: null,
    weight: null,
    quantity: null,
    note: null,
    customization: null,
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'OUTPUTORDER':
        item.outputOrder = parseIntStrict(tok.value);
        break;
      case 'COST':
        item.cost = parseNumber(tok.value);
        break;
      case 'WT':
        item.weight = parseNumber(tok.value);
        break;
      case 'QUANTITY':
        item.quantity = parseNumber(tok.value);
        break;
      case 'NOTE':
        item.note = nonEmpty(tok.value);
        break;
      case 'CUSTOMIZATION':
        item.customization = parseCustomization(tok);
        break;
      default:
        item.extra.push(tok);
        break;
    }
  }

  return item;
}

function parentEquipSetId(id: string): string | null {
  const dot = id.lastIndexOf('.');
  return dot === -1 ? null : id.slice(0, dot);
}

function rootEquipSetId(id: string): string {
  const parts = id.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : id;
}

function handleEquipSetLine(line: PcgenRawLine, setsById: Map<string, PcgenEquipmentSet>, orderedSets: PcgenEquipmentSet[]) {
  const first = line.tokens[0]!;
  let id = '';
  let value: string | null = null;
  let quantity: number | null = null;
  let note: string | null = null;
  let useTempMods: boolean | null = null;
  const extra: PcgenToken[] = [];

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'ID':
        id = tok.value;
        break;
      case 'VALUE':
        value = nonEmpty(tok.value);
        break;
      case 'QUANTITY':
        quantity = parseNumber(tok.value);
        break;
      case 'NOTE':
        note = nonEmpty(tok.value);
        break;
      case 'USETEMPMODS':
        useTempMods = parseBool(tok.value);
        break;
      default:
        extra.push(tok);
        break;
    }
  }

  const segments = id ? id.split('.') : [];
  const isRootSet = value === null && segments.length <= 2;

  if (isRootSet) {
    const existing = id ? setsById.get(id) : undefined;
    if (existing) {
      existing.name = first.value;
      existing.useTempMods = useTempMods;
      existing.extra.push(...extra);
    } else {
      const set: PcgenEquipmentSet = {
        id: id || `0.${orderedSets.length + 1}`,
        name: first.value,
        useTempMods,
        items: [],
        extra,
      };
      setsById.set(set.id, set);
      orderedSets.push(set);
    }
    return;
  }

  const rootId = id ? rootEquipSetId(id) : (orderedSets[orderedSets.length - 1]?.id ?? '0.1');
  let parentSet = setsById.get(rootId);
  if (!parentSet) {
    parentSet = {
      id: rootId,
      name: rootId,
      useTempMods: null,
      items: [],
      extra: [],
    };
    setsById.set(rootId, parentSet);
    orderedSets.push(parentSet);
  }

  const item: PcgenEquipmentSetItem = {
    id,
    parentId: id ? parentEquipSetId(id) : null,
    location: first.value,
    itemName: value,
    quantity,
    useTempMods,
    note,
    extra,
  };
  parentSet.items.push(item);
}

function parseSpellBook(line: PcgenRawLine): PcgenSpellBook {
  const first = line.tokens[0]!;
  const book: PcgenSpellBook = {
    name: first.value,
    type: null,
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    if (tok.tag === 'TYPE') {
      book.type = parseIntStrict(tok.value);
    } else {
      book.extra.push(tok);
    }
  }

  return book;
}

function parseSpellList(line: PcgenRawLine): PcgenSpellList {
  const first = line.tokens[0]!;
  const list: PcgenSpellList = {
    className: null,
    level: null,
    spells: [],
    raw: line.raw,
    extra: [],
  };

  if (first.value.startsWith('CLASS:')) {
    list.className = nonEmpty(first.value.slice('CLASS:'.length));
  } else {
    list.className = nonEmpty(first.value);
  }

  for (const tok of line.tokens.slice(1)) {
    if (tok.tag === 'CLASS') {
      list.className = nonEmpty(tok.value);
    } else if (tok.tag === 'LEVEL') {
      list.level = parseIntStrict(tok.value);
    } else if (tok.tag === 'SPELL') {
      if (tok.value) list.spells.push(tok.value);
    } else if (tok.tag === '' && list.level === null && parseIntStrict(tok.value) !== null) {
      list.level = parseIntStrict(tok.value);
    } else {
      list.extra.push(tok);
    }
  }

  return list;
}

function parseSpellName(line: PcgenRawLine): PcgenSpellEntry {
  const first = line.tokens[0]!;
  const entry: PcgenSpellEntry = {
    spellName: first.value,
    className: null,
    book: null,
    level: null,
    times: null,
    casterLevel: null,
    dc: null,
    metamagic: [],
    source: null,
    ppCost: null,
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    applySpellToken(entry, tok);
  }
  return entry;
}

function parseSpellMem(line: PcgenRawLine): PcgenSpellEntry {
  const first = line.tokens[0]!;
  const entry: PcgenSpellEntry = {
    spellName: '',
    className: null,
    book: null,
    level: null,
    times: null,
    casterLevel: null,
    dc: null,
    metamagic: [],
    source: null,
    ppCost: null,
    extra: [],
  };

  // Detect positional format: SPELLMEM:<class>|<book>|<level>|<index>|<spellName>|TIMES:1|...
  const rest = line.tokens.slice(1);
  const positionalCount = rest.findIndex((t) => t.tag !== '');
  const leadingPositional = positionalCount === -1 ? rest : rest.slice(0, positionalCount);
  const keyedTokens = positionalCount === -1 ? [] : rest.slice(positionalCount);

  if (leadingPositional.length >= 4) {
    entry.className = nonEmpty(first.value);
    entry.book = nonEmpty(leadingPositional[0]?.value);
    entry.level = parseIntStrict(leadingPositional[1]?.value);
    // leadingPositional[2] is the 0-based spell index in older PCGen
    entry.spellName = leadingPositional[3]?.value ?? '';
    for (const extraPos of leadingPositional.slice(4)) {
      entry.extra.push(extraPos);
    }
    for (const tok of keyedTokens) {
      applySpellToken(entry, tok);
    }
  } else {
    // Keyed or hybrid format: SPELLMEM:CLASS:Wizard|BOOK:...|LEVEL:...|SPELL:... or SPELLMEM:<spellName>|CLASS:...
    if (first.value) {
      const maybeKeyed = parseToken(first.value);
      if (
        maybeKeyed.tag === 'CLASS' ||
        maybeKeyed.tag === 'SPELL' ||
        maybeKeyed.tag === 'SPELLNAME' ||
        maybeKeyed.tag === 'BOOK' ||
        maybeKeyed.tag === 'SPELLBOOK' ||
        maybeKeyed.tag === 'LEVEL'
      ) {
        applySpellToken(entry, maybeKeyed);
      } else {
        entry.spellName = first.value;
      }
    }
    for (const tok of rest) {
      applySpellToken(entry, tok);
    }
  }

  return entry;
}

function applySpellToken(entry: PcgenSpellEntry, tok: PcgenToken) {
  switch (tok.tag) {
    case 'SPELL':
    case 'SPELLNAME':
      if (tok.value) entry.spellName = tok.value;
      break;
    case 'CLASS':
      entry.className = nonEmpty(tok.value);
      break;
    case 'BOOK':
    case 'SPELLBOOK':
      entry.book = nonEmpty(tok.value);
      break;
    case 'LEVEL':
    case 'SPELLLEVEL':
      entry.level = parseIntStrict(tok.value);
      break;
    case 'TIMES':
      entry.times = parseIntStrict(tok.value);
      break;
    case 'CASTERLEVEL':
      entry.casterLevel = parseIntStrict(tok.value);
      break;
    case 'DC':
      entry.dc = parseIntStrict(tok.value);
      break;
    case 'PPCOST':
      entry.ppCost = parseNumber(tok.value);
      break;
    case 'SOURCE':
      entry.source = parseSourceToken(tok);
      break;
    case 'FEATLIST':
      if (tok.subTokens) {
        for (const sub of tok.subTokens) {
          if (sub.value) pushUnique(entry.metamagic, sub.value);
        }
      } else if (tok.value) {
        pushUnique(entry.metamagic, tok.value);
      }
      break;
    case 'METAMAGIC':
      for (const feat of tok.value.split(',').map((s) => s.trim()).filter(Boolean)) {
        pushUnique(entry.metamagic, feat);
      }
      break;
    default:
      entry.extra.push(tok);
      break;
  }
}

function parseTempBonus(line: PcgenRawLine): PcgenTempBonus {
  const first = line.tokens[0]!;
  const bonus: PcgenTempBonus = {
    name: first.value,
    target: null,
    description: null,
    equipSetId: null,
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'TEMPBONUSTARGET':
      case 'TBTARGET':
        bonus.target = nonEmpty(tok.value);
        break;
      case 'TEMPBONUSDESCR':
      case 'TBDESC':
        bonus.description = nonEmpty(tok.value);
        break;
      case 'TEMPBONUSEQSET':
      case 'EQSET':
        bonus.equipSetId = nonEmpty(tok.value);
        break;
      default:
        bonus.extra.push(tok);
        break;
    }
  }

  return bonus;
}

function parseNote(line: PcgenRawLine): PcgenNote {
  const first = line.tokens[0]!;
  const note: PcgenNote = {
    id: null,
    parentId: null,
    name: first.value,
    value: '',
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'ID':
        note.id = parseIntStrict(tok.value);
        break;
      case 'PARENTID':
        note.parentId = parseIntStrict(tok.value);
        break;
      case 'VALUE':
        note.value = tok.value;
        break;
      default:
        note.extra.push(tok);
        break;
    }
  }

  return note;
}

function parseCompanion(line: PcgenRawLine): PcgenCompanionRef {
  const first = line.tokens[0]!;
  const comp: PcgenCompanionRef = {
    name: first.value,
    type: null,
    race: null,
    hitDice: null,
    adjustment: null,
    file: null,
    extra: [],
  };

  for (const tok of line.tokens.slice(1)) {
    switch (tok.tag) {
      case 'TYPE':
        comp.type = nonEmpty(tok.value);
        break;
      case 'RACE':
        comp.race = nonEmpty(tok.value);
        break;
      case 'HITDICE':
        comp.hitDice = parseNumber(tok.value);
        break;
      case 'ADJUSTMENT':
        comp.adjustment = parseNumber(tok.value);
        break;
      case 'FILE':
        comp.file = nonEmpty(tok.value);
        break;
      default:
        comp.extra.push(tok);
        break;
    }
  }

  return comp;
}

function parseKit(line: PcgenRawLine): PcgenKit {
  const first = line.tokens[0]!;
  const rest = line.tokens.slice(1);
  const maybeCount = parseIntStrict(first.value);

  if (maybeCount !== null && rest.length > 0 && rest[0]!.tag === '') {
    return {
      count: maybeCount,
      name: rest[0]!.value,
      extra: rest.slice(1),
    };
  }

  return {
    count: null,
    name: first.value,
    extra: rest,
  };
}

/**
 * Parse a PCGen `.pcg` text file into a validated, structured `PcgenCharacter` object.
 */
export function parsePcg(content: string): PcgenCharacter {
  const clean = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const rawLines = clean.split(/\r?\n/);

  const char = createEmptyCharacter();
  const equipSetsById = new Map<string, PcgenEquipmentSet>();

  for (let i = 0; i < rawLines.length; i++) {
    const line = parseLine(rawLines[i]!, i + 1);
    if (!line) continue;

    const first = line.tokens[0]!;
    const rest = line.tokens.slice(1);

    switch (line.tag) {
      // ---- System Information
      case 'PCGVERSION':
        char.system.pcgVersion = nonEmpty(first.value);
        break;
      case 'VERSION':
        char.system.pcgenVersion = nonEmpty(first.value);
        break;
      case 'GAMEMODE':
        char.system.gameMode = nonEmpty(first.value);
        break;
      case 'CHARACTERTYPE':
        char.system.characterType = nonEmpty(first.value);
        break;
      case 'CAMPAIGN': {
        const { values } = collectRepeatedValues(line.tokens, 'CAMPAIGN');
        for (const v of values) pushUnique(char.system.campaigns, v);
        break;
      }
      case 'ROLLMETHOD': {
        const exprTok = rest.find((t) => t.tag === 'EXPRESSION');
        char.system.rollMethod = {
          method: parseIntStrict(first.value),
          rawMethod: nonEmpty(first.value),
          expression: nonEmpty(exprTok?.value),
        };
        break;
      }
      case 'PURCHASEPOINTS': {
        const typeTok = rest.find((t) => t.tag === 'TYPE');
        char.system.purchasePoints = {
          enabled: parseBool(first.value) ?? false,
          type: nonEmpty(typeTok?.value),
        };
        break;
      }
      case 'PREVIEWSHEET':
        char.system.previewSheet = nonEmpty(first.value);
        break;
      case 'TABLABEL':
        char.system.tabLabel = nonEmpty(first.value);
        break;
      case 'POOLPOINTS':
        char.system.poolPoints = parseNumber(first.value);
        break;
      case 'POOLPOINTSAVAIL':
        char.system.poolPointsAvail = parseNumber(first.value);
        break;

      // ---- Character Bio
      case 'CHARACTERNAME':
        char.bio.name = nonEmpty(first.value);
        break;
      case 'TABNAME':
        char.bio.tabName = nonEmpty(first.value);
        break;
      case 'PLAYERNAME':
        char.bio.playerName = nonEmpty(first.value);
        break;
      case 'GENDER':
        char.bio.gender = nonEmpty(first.value);
        break;
      case 'HANDED':
        char.bio.handed = nonEmpty(first.value);
        break;
      case 'AGE':
        char.bio.age = parseNumber(first.value);
        break;
      case 'AGESET':
        char.bio.ageSet = nonEmpty(first.value);
        break;
      case 'HEIGHT':
        char.bio.height = parseNumber(first.value);
        break;
      case 'WEIGHT':
        char.bio.weight = parseNumber(first.value);
        break;
      case 'SKINCOLOR':
        char.bio.skinColor = nonEmpty(first.value);
        break;
      case 'EYECOLOR':
        char.bio.eyeColor = nonEmpty(first.value);
        break;
      case 'HAIRCOLOR':
        char.bio.hairColor = nonEmpty(first.value);
        break;
      case 'HAIRSTYLE':
        char.bio.hairStyle = nonEmpty(first.value);
        break;
      case 'LOCATION':
        char.bio.location = nonEmpty(first.value);
        break;
      case 'CITY':
        char.bio.city = nonEmpty(first.value);
        break;
      case 'BIRTHDAY':
        char.bio.birthday = nonEmpty(first.value);
        break;
      case 'BIRTHPLACE':
        char.bio.birthplace = nonEmpty(first.value);
        break;
      case 'PERSONALITYTRAIT1':
        char.bio.personalityTrait1 = nonEmpty(first.value);
        break;
      case 'PERSONALITYTRAIT2':
        char.bio.personalityTrait2 = nonEmpty(first.value);
        break;
      case 'SPEECHPATTERN':
        char.bio.speechPattern = nonEmpty(first.value);
        break;
      case 'PHOBIAS':
        char.bio.phobias = nonEmpty(first.value);
        break;
      case 'INTERESTS':
        char.bio.interests = nonEmpty(first.value);
        break;
      case 'CATCHPHRASE':
        char.bio.catchPhrase = nonEmpty(first.value);
        break;
      case 'PORTRAIT':
        char.bio.portrait = nonEmpty(first.value);
        break;
      case 'PORTRAITTHUMBNAILRECT':
        char.bio.portraitThumbnailRect = nonEmpty(first.value);
        break;
      case 'CHARACTERDESC':
        char.bio.description = nonEmpty(first.value);
        break;
      case 'CHARACTERBIO':
        char.bio.biography = nonEmpty(first.value);
        break;
      case 'CHARACTERCOMP':
        char.bio.companions = nonEmpty(first.value);
        break;
      case 'CHARACTERASSET':
        char.bio.assets = nonEmpty(first.value);
        break;
      case 'CHARACTERMAGIC':
        char.bio.magic = nonEmpty(first.value);
        break;
      case 'CHARACTERDMNOTES':
        char.bio.dmNotes = nonEmpty(first.value);
        break;
      case 'SUPPRESSBIOFIELDS':
      case 'SUPPRESS_BIO_FIELDS':
        for (const tok of line.tokens) {
          const val =
            tok.tag === 'SUPPRESSBIOFIELDS' || tok.tag === 'SUPPRESS_BIO_FIELDS' || tok.tag === ''
              ? tok.value
              : `${tok.tag}:${tok.value}`;
          if (val.trim()) pushUnique(char.bio.suppressBioFields, val.trim());
        }
        break;

      // ---- Attributes
      case 'STAT': {
        const scoreTok = rest.find((t) => t.tag === 'SCORE');
        const score = parseNumber(scoreTok?.value);
        if (first.value && score !== null) {
          char.attributes.stats[first.value] = score;
        } else {
          char.warnings.push(`Line ${line.lineNumber}: malformed STAT line "${line.raw}"`);
          char.unknownLines.push(line);
        }
        break;
      }
      case 'ALIGN':
        char.attributes.alignment = nonEmpty(first.value);
        break;
      case 'RACE': {
        char.attributes.race = nonEmpty(first.value);
        for (const tok of rest) {
          if (tok.tag === 'FAVOREDCLASS' && tok.value) {
            pushUnique(char.attributes.favoredClasses, tok.value);
          }
        }
        break;
      }
      case 'FAVOREDCLASS': {
        const { values } = collectRepeatedValues(line.tokens, 'FAVOREDCLASS');
        for (const v of values) pushUnique(char.attributes.favoredClasses, v);
        break;
      }
      case 'REGION':
        char.attributes.region = nonEmpty(first.value);
        break;
      case 'TEMPLATE': {
        const { values } = collectRepeatedValues(line.tokens, 'TEMPLATE');
        for (const v of values) pushUnique(char.attributes.templates, v);
        break;
      }
      case 'TEMPLATESAPPLIED': {
        for (const tok of line.tokens) {
          if (tok.tag !== 'TEMPLATESAPPLIED') continue;
          const applied = parseAppliedTemplate(tok);
          char.attributes.appliedTemplates.push(applied);
          if (applied.name) pushUnique(char.attributes.templates, applied.name);
        }
        break;
      }
      case 'DEITY':
        char.attributes.deity = parseDeity(line);
        break;
      case 'DOMAIN':
        char.attributes.domains.push(parseDomain(line));
        break;
      case 'LANGUAGE': {
        const { values } = collectRepeatedValues(line.tokens, 'LANGUAGE');
        for (const v of values) pushUnique(char.attributes.languages, v);
        break;
      }
      case 'WEAPONPROF': {
        for (const tok of line.tokens) {
          if (tok.tag !== 'WEAPONPROF') continue;
          if (tok.subTokens) {
            for (const sub of tok.subTokens) {
              if (sub.value) pushUnique(char.attributes.weaponProficiencies, sub.value);
            }
          } else if (tok.value) {
            pushUnique(char.attributes.weaponProficiencies, tok.value);
          }
        }
        break;
      }

      // ---- Experience & Money
      case 'EXPERIENCE':
        char.experience.xp = parseNumber(first.value);
        break;
      case 'EXPERIENCETABLE':
        char.experience.table = nonEmpty(first.value);
        break;
      case 'MONEY':
      case 'GOLD':
        char.money.raw = nonEmpty(first.value);
        char.money.amount = parseNumber(first.value);
        break;

      // ---- Classes & Levels
      case 'CLASS':
        char.classes.push(parseClass(line, char.warnings));
        break;
      case 'CLASSABILITIESLEVEL':
        char.classLevels.push(parseClassLevel(line, char.warnings));
        break;

      // ---- Skills
      case 'SKILL':
        char.skills.push(parseSkill(line));
        break;

      // ---- Abilities & Feats
      case 'ABILITY':
        char.abilities.push(parseAbility(line));
        break;
      case 'FEAT': {
        const { values } = collectRepeatedValues(line.tokens, 'FEAT');
        char.legacyFeats.push(...values);
        break;
      }
      case 'VFEAT': {
        const { values } = collectRepeatedValues(line.tokens, 'VFEAT');
        char.virtualFeats.push(...values);
        break;
      }
      case 'FEATPOOL': {
        const pts = parseNumber(first.value);
        if (pts !== null) char.abilityPools['FEAT'] = pts;
        break;
      }
      case 'USERPOOL': {
        const ptsTok = rest.find((t) => t.tag === 'POOLPOINTS');
        const pts = parseNumber(ptsTok?.value);
        if (first.value && pts !== null) {
          char.abilityPools[first.value] = pts;
        } else {
          char.warnings.push(`Line ${line.lineNumber}: malformed USERPOOL line "${line.raw}"`);
        }
        break;
      }

      // ---- Equipment
      case 'EQUIPNAME':
        char.equipment.push(parseEquipmentItem(line));
        break;
      case 'EQUIPSET':
        handleEquipSetLine(line, equipSetsById, char.equipmentSets);
        break;
      case 'CALCEQUIPSET':
        char.activeEquipmentSetId = nonEmpty(first.value);
        break;

      // ---- Spells
      case 'SPELLBOOK':
        char.spells.spellBooks.push(parseSpellBook(line));
        break;
      case 'SPELLLIST':
        char.spells.spellLists.push(parseSpellList(line));
        break;
      case 'SPELLNAME':
        char.spells.entries.push(parseSpellName(line));
        break;
      case 'SPELLMEM':
        char.spells.entries.push(parseSpellMem(line));
        break;

      // ---- Temp Bonuses, Notes, Companions, Kits, Chronicle
      case 'TEMPBONUS':
      case 'TEMPBONUSEQSET':
        char.tempBonuses.push(parseTempBonus(line));
        break;
      case 'NOTE':
        char.notes.push(parseNote(line));
        break;
      case 'MASTER':
        char.companions.masters.push(parseCompanion(line));
        break;
      case 'FOLLOWER':
        char.companions.followers.push(parseCompanion(line));
        break;
      case 'KIT':
        char.kits.push(parseKit(line));
        break;
      case 'CHRONICLEENTRY':
        char.chronicleEntries.push(line);
        break;

      default: {
        if (BOOLEAN_SYSTEM_SETTINGS.has(line.tag)) {
          const b = parseBool(first.value);
          char.system.settings[line.tag] = b ?? first.value;
        } else if (NUMERIC_SYSTEM_SETTINGS.has(line.tag)) {
          const n = parseNumber(first.value);
          char.system.settings[line.tag] = n ?? first.value;
        } else {
          char.unknownLines.push(line);
        }
        break;
      }
    }
  }

  return PcgenCharacterSchema.parse(char);
}

/**
 * Parse a PCGen `.pcg` text file and serialize the result to JSON.
 */
export function parsePcgToJson(content: string, pretty = true): string {
  const parsed = parsePcg(content);
  return JSON.stringify(parsed, null, pretty ? 2 : undefined);
}

/** An empty build (for characters made in the VTT, e.g. monsters imported from Archives of Nethys). */
export function emptyPcgenBuild(): PcgenCharacter {
  return createEmptyCharacter();
}
