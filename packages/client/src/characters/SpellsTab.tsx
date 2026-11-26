/**
 * Spells (Epic 7): per casting class, caster level / concentration / DCs,
 * slots and prepared spells by level, Cast (spell card in chat, optional area
 * template), spontaneous Cure/Inflict/Summon Nature's Ally conversion,
 * Rest & prepare, and casting settings for classes the rules don't know.
 */
import { useMemo, useState } from 'react';
import {
  canManageCharacter,
  characterSheetActions,
  characterSpellcasting,
  checkPrepared,
  computeCharacterStats,
  conversionSpell,
  isHeighten,
  KNOWN_BOOK,
  lookupSpell,
  MAX_PREPARED_PER_CLASS,
  metamagicLevels,
  newId,
  normalizeName,
  ordinal,
  pf1eTurnActions,
  planCast,
  preparableSpells,
  signed,
  spellActions,
  spellCard,
  spellDc,
  spellDcLevel,
  spellSlotKey,
  STAT_KEYS,
  type CasterInfo,
  type CastRequest,
  type Character,
  type ConversionKind,
  type PrepareEntry,
  type PreparedSpell,
  type SpellcastingOverride,
  type SpellLevelInfo,
  type StatKey,
} from '@vtt/shared';
import { NumberField, OptionalNumberField, SelectField, TextField } from '../components/fields';
import { dispatch } from '../state/dispatch';
import { useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { currentWhisper } from '../state/uiStore';
import { armTemplate } from '../tools/templateTool';
import { rollCheck } from './characterActions';

const MODEL_LABEL = { prepared: 'prepared', spontaneous: 'spontaneous', hybrid: 'prepared + spontaneous' } as const;
const CONVERT_LABEL: Record<ConversionKind, string> = { cure: 'Cure', inflict: 'Inflict', sna: 'SNA' };

export function SpellsTab({ character: c }: { character: Character }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const stats = useMemo(() => computeCharacterStats(c), [c]);
  const casters = useMemo(() => characterSpellcasting(c, stats), [c, stats]);
  const [placeArea, setPlaceArea] = useState(true);

  return (
    <div className="spells">
      <div className="section-header">
        <h3>Spellcasting</h3>
        {manage && casters.length > 0 && (
          <button
            type="button"
            className="small"
            title="Restore spell slots, un-cast prepared spells and restore every resource (8 hours of rest)"
            onClick={() => confirm('Rest 8 hours? Restores spell slots, prepared spells and every resource.') && dispatch(pf1eTurnActions.resetUses.create({ characterId: c.id }))}
          >
            Rest (8 hr)
          </button>
        )}
      </div>
      {casters.length === 0 && <p className="muted">No spellcasting classes. {manage ? 'A class the rules don’t know can be set up below.' : ''}</p>}
      {manage && casters.length > 0 && (
        <label className="inline-control small-text">
          <input type="checkbox" checked={placeArea} onChange={(e) => setPlaceArea(e.target.checked)} /> Place the area template after casting a spell with an area
        </label>
      )}
      {casters.map((info) => (
        <CasterSection key={info.className} character={c} info={info} manage={manage} placeArea={placeArea} asf={stats.armor.asf} />
      ))}
      {manage && <AddCasterClass character={c} casters={casters} />}
      <p className="muted small-text">
        Spell details (school, save, SR, area) come from a built-in list of common spells; other spells show their DC only. Spell Focus applies when the school
        is known.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ one class

function CasterSection({ character: c, info, manage, placeArea, asf }: { character: Character; info: CasterInfo; manage: boolean; placeArea: boolean; asf: number }) {
  const [panel, setPanel] = useState<'none' | 'prepare' | 'settings'>('none');
  const [metamagic, setMetamagic] = useState<string[]>([]);
  const spontaneousMm = info.model !== 'prepared' ? info.metamagic.filter((m) => !isHeighten(m)) : [];

  const cast = (req: Omit<CastRequest, 'className'>) => {
    const full: CastRequest = { className: info.className, ...req };
    const plan = planCast(c, full);
    if (typeof plan === 'string') return notify(plan);
    const ok = dispatch(spellActions.cast.create({ characterId: c.id, chatId: newId(), whisper: currentWhisper(), ...full }));
    const area = spellCard(c, plan).area;
    if (ok && placeArea && area) armTemplate(area);
  };

  return (
    <section className="caster">
      <div className="section-header">
        <h3>
          {info.className} {info.classLevel} <span className="badge subtle">{MODEL_LABEL[info.model]}</span>
        </h3>
        {manage && info.model !== 'spontaneous' && (
          <button type="button" className={`small${panel === 'prepare' ? ' active' : ''}`} onClick={() => setPanel(panel === 'prepare' ? 'none' : 'prepare')}>
            Prepare…
          </button>
        )}
        {manage && (
          <button
            type="button"
            className={`small icon-button${panel === 'settings' ? ' active' : ''}`}
            title="Casting settings"
            aria-label={`${info.className} casting settings`}
            onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
          >
            ⚙
          </button>
        )}
      </div>
      <div className="caster-stats small-text">
        <span title={`Caster level${info.def?.clOffset ? ` (class level ${info.def.clOffset})` : ''}`}>CL {info.casterLevel}</span>
        <button type="button" className="small rollable" title="Concentration check (caster level + casting ability)" onClick={() => rollCheck(c, `${info.className} concentration`, info.concentration)}>
          Concentration {signed(info.concentration)}
        </button>
        <span title="Save DC = 10 + spell level + casting ability (+ Spell Focus)">DC {info.dcBase} + level</span>
        <span>
          {info.stat} {info.abilityScore} ({signed(info.abilityMod)})
        </span>
        {info.tradition === 'arcane' && asf > 0 && <span className="warn-text">ASF {asf}%</span>}
      </div>
      {info.warnings.map((w) => (
        <p key={w} className="warn-text small-text">
          {w}
        </p>
      ))}
      {panel === 'settings' && <CastingSettings character={c} info={info} />}
      {panel === 'prepare' && <PreparePanel character={c} info={info} onDone={() => setPanel('none')} />}

      {spontaneousMm.length > 0 && manage && (
        <div className="combat-toggles" role="group" aria-label="Metamagic for the next cast">
          <span className="muted small-text">Metamagic:</span>
          {spontaneousMm.map((m) => (
            <button
              key={m}
              type="button"
              className={`small toggle-chip${metamagic.includes(m) ? ' active' : ''}`}
              aria-pressed={metamagic.includes(m)}
              onClick={() => setMetamagic(metamagic.includes(m) ? metamagic.filter((x) => x !== m) : [...metamagic, m])}
            >
              {m.replace(/ Spell$/, '')}
            </button>
          ))}
        </div>
      )}

      {info.model !== 'spontaneous' && info.preparedFromFile && info.prepared.length > 0 && (
        <p className="muted small-text">Prepared spells from the .pcg file{info.books[0] ? ` (${info.books[0].name})` : ''}. Use Prepare… to change them.</p>
      )}
      {info.model !== 'spontaneous' && info.prepared.length === 0 && <p className="muted small-text">Nothing prepared yet{manage ? ': use Prepare…' : ''}.</p>}

      {info.levels.length === 0 && <p className="muted small-text">No spells per day at this level yet.</p>}
      <ul className="spell-levels">
        {info.levels.map((li) => (
          <li key={li.level}>
            {info.model === 'prepared' ? (
              <PreparedLevel character={c} info={info} li={li} manage={manage} onCast={cast} />
            ) : (
              <SlotLevel character={c} info={info} li={li} manage={manage} metamagic={metamagic} onCast={cast} />
            )}
          </li>
        ))}
      </ul>
      {info.known.length > 0 && <KnownList info={info} />}
    </section>
  );
}

function LevelHead({ li, children }: { li: SpellLevelInfo; children?: React.ReactNode }) {
  return (
    <div className="spell-level-head">
      <span className="spell-level-name">{li.level === 0 ? 'Cantrips' : ordinal(li.level)}</span>
      {!li.castable && <span className="warn-text small-text">ability too low</span>}
      {children}
    </div>
  );
}

function Pips({ total, left }: { total: number; left: number }) {
  if (total > 30) return null;
  return (
    <span className="pips inline" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`pip-dot${i < left ? '' : ' spent'}`} />
      ))}
    </span>
  );
}

function SpellName({ c, info, name, slotLevel, metamagic }: { c: Character; info: CasterInfo; name: string; slotLevel: number; metamagic: string[] }) {
  const ref = lookupSpell(name);
  const dcLevel = spellDcLevel(info, name, slotLevel, metamagic);
  const dc = spellDc(c, info, name, dcLevel);
  const title = ref ? `${ref.school}\nSave: ${ref.save} (DC ${dc}) · SR: ${ref.sr}${ref.area ? `\nArea: ${ref.area.label}` : ''}\n${ref.text}` : `DC ${dc}`;
  return (
    <span className="spell-name" title={title}>
      {name}
      {metamagic.map((m) => (
        <span key={m} className="badge subtle">
          {m.replace(/ Spell$/, '')}
        </span>
      ))}
      {ref?.area && <span className="muted small-text"> 📐</span>}
    </span>
  );
}

/** Spontaneous and hybrid casters: slots for the level, and the spells known / prepared at it. */
function SlotLevel({
  character: c,
  info,
  li,
  manage,
  metamagic,
  onCast,
}: {
  character: Character;
  info: CasterInfo;
  li: SpellLevelInfo;
  manage: boolean;
  metamagic: string[];
  onCast: (req: Omit<CastRequest, 'className'>) => void;
}) {
  const spells = (info.model === 'hybrid' ? info.prepared : info.known).filter((s) => s.level === li.level);
  const left = Math.max(0, li.perDay - li.used);
  const adjust = (delta: number) => dispatch(pf1eTurnActions.adjustUse.create({ characterId: c.id, key: spellSlotKey(info.className, li.level), delta }));
  return (
    <>
      <LevelHead li={li}>
        {li.atWill ? (
          <span className="muted small-text">at will</span>
        ) : (
          <>
            <span className={`small-text${left === 0 ? ' warn-text' : ''}`} title={li.bonus ? `${li.base} from the class table + ${li.bonus} bonus from ${info.stat}` : undefined}>
              {left}/{li.perDay} slots
            </span>
            <Pips total={li.perDay} left={left} />
            {manage && li.perDay > 0 && (
              <>
                <button type="button" className="small push-right" aria-label={`Spend a ${ordinal(li.level)}-level slot`} disabled={left === 0} onClick={() => adjust(1)}>
                  −
                </button>
                <button type="button" className="small" aria-label={`Restore a ${ordinal(li.level)}-level slot`} disabled={li.used === 0} onClick={() => adjust(-1)}>
                  +
                </button>
              </>
            )}
          </>
        )}
      </LevelHead>
      <ul className="spell-list">
        {spells.map((s) => {
          const req = { spellName: s.name, level: s.level, metamagic };
          const plan = planCast(c, { className: info.className, ...req });
          const slot = typeof plan === 'string' ? null : plan.slotLevel;
          return (
            <li key={`${s.name}|${s.level}`}>
              <SpellName c={c} info={info} name={s.name} slotLevel={s.level} metamagic={[]} />
              {manage && (
                <button type="button" className="small" disabled={typeof plan === 'string'} title={typeof plan === 'string' ? plan : 'Cast: post the spell card to chat'} onClick={() => onCast(req)}>
                  Cast{slot !== null && slot !== s.level ? ` (${ordinal(slot)})` : ''}
                </button>
              )}
            </li>
          );
        })}
        {spells.length === 0 && <li className="muted small-text">{info.model === 'hybrid' ? 'None prepared.' : 'None known.'}</li>}
      </ul>
    </>
  );
}

/** Prepared casters: each prepared casting, checked off when cast. */
function PreparedLevel({
  character: c,
  info,
  li,
  manage,
  onCast,
}: {
  character: Character;
  info: CasterInfo;
  li: SpellLevelInfo;
  manage: boolean;
  onCast: (req: Omit<CastRequest, 'className'>) => void;
}) {
  const spells = info.prepared.filter((p) => p.level === li.level);
  const normal = spells.filter((p) => p.slot === 'normal');
  const left = spells.filter((p) => !p.cast).length;
  const mark = (p: PreparedSpell, cast: boolean) =>
    dispatch(spellActions.markPrepared.create({ characterId: c.id, className: info.className, preparedId: p.id, cast }));
  return (
    <>
      <LevelHead li={li}>
        {li.atWill ? (
          <span className="muted small-text">
            at will · {normal.length}/{li.prepareLimit} prepared
          </span>
        ) : (
          <span className="small-text">
            {left}/{spells.length} left · {normal.length}/{li.prepareLimit} slots{li.extra ? ` + ${li.extra} ${info.bonusSlot}` : ''}
          </span>
        )}
      </LevelHead>
      <ul className="spell-list">
        {spells.map((p) => {
          const atWill = li.atWill;
          return (
            <li key={p.id} className={p.cast && !atWill ? 'spent' : ''}>
              {!atWill && (
                <input
                  type="checkbox"
                  checked={p.cast}
                  disabled={!manage}
                  aria-label={`${p.name} cast`}
                  title={p.cast ? 'Cast today (uncheck to undo)' : 'Check off without posting'}
                  onChange={(e) => mark(p, e.target.checked)}
                />
              )}
              <SpellName c={c} info={info} name={p.name} slotLevel={p.level} metamagic={p.metamagic} />
              {p.slot === 'bonus' && <span className="badge">{info.bonusSlot}</span>}
              {manage && (
                <button type="button" className="small" disabled={p.cast && !atWill} onClick={() => onCast({ preparedId: p.id })} title="Cast: post the spell card to chat">
                  Cast
                </button>
              )}
              {manage &&
                !p.cast &&
                p.slot === 'normal' &&
                li.level > 0 &&
                info.conversions.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="small"
                    title={`Lose ${p.name} to cast ${conversionSpell(k, li.level)?.[0]} instead`}
                    onClick={() => onCast({ preparedId: p.id, convert: k })}
                  >
                    → {CONVERT_LABEL[k]}
                  </button>
                ))}
            </li>
          );
        })}
        {spells.length === 0 && <li className="muted small-text">None prepared.</li>}
      </ul>
    </>
  );
}

function KnownList({ info }: { info: CasterInfo }) {
  const [open, setOpen] = useState(false);
  const label = info.def?.book ? (info.def.noun === 'extracts' ? 'Formula book' : 'Spellbook') : info.model === 'prepared' ? KNOWN_BOOK : 'Spells known';
  return (
    <details className="known-spells" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="small-text">
        {label} ({info.known.length})
      </summary>
      {open &&
        [...new Set(info.known.map((k) => k.level))].map((level) => (
          <div key={level} className="small-text">
            <strong>{level === 0 ? 'Cantrips' : ordinal(level)}:</strong>{' '}
            {info.known
              .filter((k) => k.level === level)
              .map((k) => k.name)
              .join(', ')}
          </div>
        ))}
    </details>
  );
}

// ------------------------------------------------------------------ preparing

const toEntries = (list: PreparedSpell[]): PrepareEntry[] => list.map(({ id, name, level, metamagic, slot }) => ({ id, name, level, metamagic: [...metamagic], slot }));

/** Fill the normal slots first and overflow into the domain/school slot, as PCGen doesn't mark which is which. */
function fitSlots(info: CasterInfo, list: PrepareEntry[]): PrepareEntry[] {
  const used = new Map<string, number>();
  return list.map((p) => {
    const li = info.levels.find((x) => x.level === p.level);
    const n = used.get(`${p.level}|normal`) ?? 0;
    if (li && n >= li.prepareLimit && li.extra > (used.get(`${p.level}|bonus`) ?? 0)) {
      used.set(`${p.level}|bonus`, (used.get(`${p.level}|bonus`) ?? 0) + 1);
      return { ...p, slot: 'bonus' as const };
    }
    used.set(`${p.level}|normal`, n + 1);
    return { ...p, slot: 'normal' as const };
  });
}

function PreparePanel({ character: c, info, onDone }: { character: Character; info: CasterInfo; onDone: () => void }) {
  const [draft, setDraft] = useState<PrepareEntry[]>(() => toEntries(info.prepared));
  const [mm, setMm] = useState<string[]>([]);
  const [mmSpell, setMmSpell] = useState('');
  const [freeName, setFreeName] = useState('');
  const levels = info.levels.filter((l) => l.castable && (l.prepareLimit > 0 || l.extra > 0));
  const [freeLevel, setFreeLevel] = useState(() => levels.find((l) => l.level === 1)?.level ?? levels[0]?.level ?? 0);
  const selectedFreeLevel = levels.some((l) => l.level === freeLevel) ? freeLevel : (levels[0]?.level ?? 0);
  const choices = useMemo(() => preparableSpells(info), [info]);
  const check = checkPrepared(c, info.className, draft);
  const hybrid = info.model === 'hybrid';
  const prepMetamagic = hybrid ? [] : info.metamagic.filter((m) => !isHeighten(m));

  const add = (name: string, level: number, metamagic: string[] = []) => {
    const li = info.levels.find((x) => x.level === level);
    const normal = draft.filter((p) => p.level === level && p.slot === 'normal').length;
    const bonus = draft.filter((p) => p.level === level && p.slot === 'bonus').length;
    const slot = li && normal >= li.prepareLimit && bonus < li.extra ? 'bonus' : 'normal';
    setDraft([...draft, { id: newId(), name, level, metamagic, slot }]);
  };
  const save = () => {
    if (check !== true) return notify(check);
    if (dispatch(spellActions.prepare.create({ characterId: c.id, className: info.className, spells: draft }))) onDone();
  };

  return (
    <div className="prepare-panel">
      <div className="button-row">
        {info.books.map((b) => (
          <button
            key={b.name}
            type="button"
            className="small"
            title={`Replace the list with the .pcg book "${b.name}"`}
            onClick={() => {
              const seen = new Set<string>();
              const loaded = b.spells
                .flatMap((s) => {
                  if (hybrid) {
                    const k = `${normalizeName(s.name)}|${s.level}`;
                    if (seen.has(k)) return [];
                    seen.add(k);
                  }
                  const count = hybrid ? 1 : Math.max(1, Math.min(10, s.times));
                  return Array.from({ length: count }, () => ({
                    id: newId(),
                    name: s.name.slice(0, 80),
                    level: s.level,
                    metamagic: hybrid ? [] : s.metamagic.slice(0, 6),
                    slot: 'normal' as const,
                  }));
                })
                .slice(0, MAX_PREPARED_PER_CLASS);
              setDraft(fitSlots(info, loaded));
            }}
          >
            Load “{b.name}”
          </button>
        ))}
        <button type="button" className="small" onClick={() => setDraft([])}>
          Clear
        </button>
      </div>
      {levels.map((li) => {
        const here = draft.filter((p) => p.level === li.level);
        const normal = here.filter((p) => p.slot === 'normal').length;
        const bonus = here.length - normal;
        const options = choices.filter((s) => s.level === li.level);
        return (
          <div key={li.level} className="prepare-level">
            <div className="spell-level-head">
              <span className="spell-level-name">{li.level === 0 ? 'Cantrips' : ordinal(li.level)}</span>
              <span className={`small-text${normal > li.prepareLimit ? ' warn-text' : ''}`}>
                {normal}/{li.prepareLimit}
              </span>
              {li.extra > 0 && (
                <span className={`small-text${bonus > li.extra ? ' warn-text' : ''}`}>
                  + {bonus}/{li.extra} {info.bonusSlot}
                </span>
              )}
              {options.length > 0 && (
                <select
                  value=""
                  aria-label={`Add a ${ordinal(li.level)}-level spell`}
                  onChange={(e) => {
                    if (e.target.value) add(e.target.value, li.level);
                  }}
                >
                  <option value="">+ add…</option>
                  {options.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <ul className="spell-list">
              {here.map((p) => (
                <li key={p.id}>
                  <span className="spell-name">
                    {p.name}
                    {p.metamagic.map((m) => (
                      <span key={m} className="badge subtle">
                        {m.replace(/ Spell$/, '')}
                      </span>
                    ))}
                  </span>
                  {li.extra > 0 && (
                    <button
                      type="button"
                      className={`small toggle-chip${p.slot === 'bonus' ? ' active' : ''}`}
                      title={`Prepared in the ${info.bonusSlot} slot`}
                      aria-pressed={p.slot === 'bonus'}
                      onClick={() => setDraft(draft.map((x) => (x.id === p.id ? { ...x, slot: x.slot === 'bonus' ? 'normal' : 'bonus' } : x)))}
                    >
                      {info.bonusSlot}
                    </button>
                  )}
                  <button type="button" className="small icon-button" aria-label={`Remove ${p.name}`} onClick={() => setDraft(draft.filter((x) => x.id !== p.id))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {prepMetamagic.length > 0 && (
        <div className="prepare-metamagic">
          <span className="small-text muted">With metamagic:</span>
          <select value={mmSpell} onChange={(e) => setMmSpell(e.target.value)} aria-label="Spell to prepare with metamagic">
            <option value="">spell…</option>
            {choices
              .filter((s) => s.level > 0 || info.levels[0]?.castable)
              .map((s) => (
                <option key={`${s.name}|${s.level}`} value={`${s.level}|${s.name}`}>
                  {s.name} ({ordinal(s.level)})
                </option>
              ))}
          </select>
          {prepMetamagic.map((m) => (
            <button key={m} type="button" className={`small toggle-chip${mm.includes(m) ? ' active' : ''}`} onClick={() => setMm(mm.includes(m) ? mm.filter((x) => x !== m) : [...mm, m])}>
              {m.replace(/ Spell$/, '')}
            </button>
          ))}
          <button
            type="button"
            className="small"
            disabled={!mmSpell || mm.length === 0}
            onClick={() => {
              const [lvl, ...rest] = mmSpell.split('|');
              const slot = Number(lvl) + metamagicLevels(mm);
              if (slot > info.maxLevel) return notify(`That needs a ${ordinal(Math.min(9, slot))}-level slot`);
              add(rest.join('|'), slot, mm);
              setMm([]);
            }}
          >
            + Add{mmSpell && mm.length ? ` (${ordinal(Math.min(9, Number(mmSpell.split('|')[0]) + metamagicLevels(mm)))} slot)` : ''}
          </button>
        </div>
      )}
      {!info.def?.book && (
        <div className="prepare-metamagic">
          <span className="small-text muted">Any {info.className} spell:</span>
          <input value={freeName} maxLength={80} placeholder="Spell name" onChange={(e) => setFreeName(e.target.value)} />
          <select value={selectedFreeLevel} onChange={(e) => setFreeLevel(Number(e.target.value))} aria-label="Spell level">
            {levels.map((l) => (
              <option key={l.level} value={l.level}>
                {ordinal(l.level)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="small"
            disabled={!freeName.trim()}
            onClick={() => {
              add(freeName.trim(), selectedFreeLevel);
              setFreeName('');
            }}
          >
            + Add
          </button>
        </div>
      )}
      {check !== true && <p className="warn-text small-text">{check}</p>}
      <div className="button-row">
        <button type="button" className="primary small" disabled={check !== true} onClick={save}>
          Save prepared spells
        </button>
        <button type="button" className="small" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="muted small-text">Saving starts the day: every prepared spell is ready to cast. Rest (8 hr) also restores what you cast without changing the list.</p>
    </div>
  );
}

// ------------------------------------------------------------------ settings

const EMPTY_OVERRIDE: SpellcastingOverride = { model: null, stat: null, casterLevel: null, perDay: null, dcBonus: 0, concentrationBonus: 0 };

function saveOverride(c: Character, className: string, changes: Partial<SpellcastingOverride> | null) {
  const next = { ...c.sheet.spellcasting };
  if (changes === null) delete next[className];
  else next[className] = { ...EMPTY_OVERRIDE, ...next[className], ...changes };
  dispatch(characterSheetActions.updateSheet.create({ id: c.id, changes: { spellcasting: next } }));
}

function parsePerDay(text: string): (number | null)[] | null | 'invalid' {
  if (!text.trim()) return null;
  const parts = text.split(',').map((x) => x.trim());
  if (parts.length > 10) return 'invalid';
  const out = parts.map((x) => (x === '-' || x === '' ? null : Number(x)));
  return out.every((x) => x === null || (Number.isInteger(x) && x >= 0 && x <= 20)) ? out : 'invalid';
}

function CastingSettings({ character: c, info }: { character: Character; info: CasterInfo }) {
  const o = c.sheet.spellcasting[info.className] ?? EMPTY_OVERRIDE;
  const set = (changes: Partial<SpellcastingOverride>) => saveOverride(c, info.className, changes);
  return (
    <div className="casting-settings">
      <SelectField
        label="Casting"
        value={o.model ?? ''}
        options={[
          { value: '', label: `Rules (${info.def ? MODEL_LABEL[info.def.model] : 'detected'})` },
          { value: 'prepared', label: 'Prepared' },
          { value: 'spontaneous', label: 'Spontaneous' },
          { value: 'hybrid', label: 'Prepared + spontaneous (arcanist)' },
        ]}
        onCommit={(v) => set({ model: v === '' ? null : v })}
      />
      <SelectField
        label="Ability"
        value={o.stat ?? ''}
        options={[{ value: '', label: `Rules (${info.def?.stat ?? info.stat})` }, ...STAT_KEYS.map((k) => ({ value: k, label: k }))]}
        onCommit={(v) => set({ stat: v === '' ? null : (v as StatKey) })}
      />
      <OptionalNumberField label="Caster level" value={o.casterLevel} min={0} max={40} placeholder={String(info.casterLevel)} onCommit={(v) => set({ casterLevel: v })} />
      <TextField
        label="Spells per day (0th, 1st, ...)"
        value={o.perDay ? o.perDay.map((x) => (x === null ? '-' : String(x))).join(',') : ''}
        placeholder={info.def ? 'from the class table' : 'e.g. 3,1'}
        onCommit={(v) => {
          const parsed = parsePerDay(v);
          if (parsed === 'invalid') return notify('Spells per day: up to 10 numbers (0-20) separated by commas, - for none');
          set({ perDay: parsed });
        }}
      />
      <NumberField label="DC bonus" value={o.dcBonus} min={-10} max={10} onCommit={(v) => set({ dcBonus: v })} />
      <NumberField label="Concentration bonus" value={o.concentrationBonus} min={-20} max={20} onCommit={(v) => set({ concentrationBonus: v })} />
      {c.sheet.spellcasting[info.className] && (
        <button type="button" className="small" onClick={() => saveOverride(c, info.className, null)}>
          Reset to rules
        </button>
      )}
    </div>
  );
}

function AddCasterClass({ character: c, casters }: { character: Character; casters: CasterInfo[] }) {
  const others = c.build.classes.filter((k) => !casters.some((i) => i.className === k.name));
  if (others.length === 0) return null;
  return (
    <div className="button-row small-text">
      <span className="muted">Casts spells but isn’t listed?</span>
      {others.map((k) => (
        <button key={k.name} type="button" className="small" onClick={() => saveOverride(c, k.name, {})}>
          + {k.name}
        </button>
      ))}
    </div>
  );
}
