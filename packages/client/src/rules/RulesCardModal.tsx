/**
 * Rules card modal (Epic 11, #55): shows description, structured PF1e fields,
 * source book + page citation ("Core Rulebook p.283") and a "View on AoN"
 * deep link (no fetching).
 */
import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, X } from 'lucide-react';
import { useDialogStore } from '../state/dialogs';
import {
  aonEquipmentKind,
  aonUrl,
  baseCost,
  citation,
  lookupSpell,
  spellLevelLine,
  spellSchoolLine,
  type AonKind,
  type CustomRule,
  type EquipmentRecord,
  type FeatRecord,
  type RulesRecord,
  type SpellRecord,
} from '@vtt/shared';
import { request } from '../net/rpc';
import { useRulesUi, type RulesCardTarget } from './store';

function defaultAonKind(target: RulesCardTarget, rec: RulesRecord | null): AonKind {
  if (target.aonKind) return target.aonKind;
  if (rec?.kind === 'equipment') return aonEquipmentKind(rec.types);
  switch (target.kind) {
    case 'spell':
      return 'spell';
    case 'feat':
      return 'feat';
    case 'ability':
      return 'search';
    case 'deity':
      return 'deity';
    case 'domain':
      return 'domain';
    case 'class':
      return 'class';
    case 'race':
      return 'race';
    case 'equipment':
      return 'equipment';
    default:
      return 'search';
  }
}

export function RulesCardModal() {
  const card = useRulesUi((s) => s.card);
  const close = useRulesUi((s) => s.closeCard);
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<RulesRecord | null>(null);
  const [custom, setCustom] = useState<CustomRule | null>(null);

  useEffect(() => {
    if (!card) return;
    let alive = true;
    setLoading(true);
    setRecord(null);
    setCustom(null);
    request('rules.get', {
      kind: card.kind,
      ...(card.key ? { key: card.key } : {}),
      ...(card.customId ? { customId: card.customId } : {}),
      name: card.name,
    })
      .then((res) => {
        if (!alive) return;
        setRecord(res.record);
        setCustom(res.custom);
      })
      .catch(() => {
        // Fallback silently to AoN link + built-in spell data.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [card]);

  useEffect(() => {
    if (!card) return;
    // Capture phase + stopImmediatePropagation: the card is the top-most layer (z 95), so it alone
    // consumes Escape even when the compendium/catalog/handout listeners were registered earlier.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useDialogStore.getState().current) return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [card, close]);

  if (!card) return null;

  const builtInSpell = !record && !custom && card.kind === 'spell' ? lookupSpell(card.name) : undefined;
  const title = record?.name ?? custom?.name ?? card.name;
  const sourceLine = record ? citation(record.source) : custom?.source || '';
  const linkUrl = custom?.aonUrl || aonUrl(defaultAonKind(card, record), title);

  return (
    <div className="modal-backdrop modal-backdrop-top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-card rules-card-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="section-header">
          <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={15} /> {title}
          </h3>
          <button type="button" className="icon-button" aria-label="Close rules card" onClick={close}>
            <X size={15} />
          </button>
        </div>

        {sourceLine && <div className="muted small-text rules-citation">{sourceLine}</div>}
        {loading && <p className="muted small-text">Looking up rules data…</p>}

        {record && <RecordDetails record={record} />}
        {custom && <CustomDetails custom={custom} />}
        {builtInSpell && (
          <div className="rules-body small-text">
            <div>
              <strong>School:</strong> {builtInSpell.school}
            </div>
            <div>
              <strong>Save:</strong> {builtInSpell.save} · <strong>SR:</strong> {builtInSpell.sr}
            </div>
            {builtInSpell.area && (
              <div>
                <strong>Area:</strong> {builtInSpell.area.label}
              </div>
            )}
            <p className="rules-desc">{builtInSpell.text}</p>
          </div>
        )}

        {!loading && !record && !custom && !builtInSpell && (
          <p className="muted small-text">
            Not found in the server’s loaded rules pack (or no pack has been built yet). Use the link below to view it on Archives of Nethys.
          </p>
        )}

        <div className="button-row modal-actions">
          <a className="button-link small gold" href={linkUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={12} /> View on AoN
          </a>
          <button type="button" className="small" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordDetails({ record }: { record: RulesRecord }) {
  if (record.kind === 'spell') {
    const s = record as SpellRecord;
    const levels = spellLevelLine(s.classes);
    return (
      <div className="rules-body small-text">
        <div>
          <strong>School:</strong> {spellSchoolLine(s)}
        </div>
        {levels && (
          <div>
            <strong>Level:</strong> {levels}
          </div>
        )}
        {s.castTime && (
          <div>
            <strong>Casting Time:</strong> {s.castTime}
          </div>
        )}
        {s.components && (
          <div>
            <strong>Components:</strong> {s.components}
          </div>
        )}
        {s.range && (
          <div>
            <strong>Range:</strong> {s.range}
          </div>
        )}
        {s.targetArea && (
          <div>
            <strong>Target / Area:</strong> {s.targetArea}
          </div>
        )}
        {s.duration && (
          <div>
            <strong>Duration:</strong> {s.duration}
          </div>
        )}
        {(s.save || s.sr) && (
          <div>
            <strong>Saving Throw:</strong> {s.save ?? 'none'} · <strong>Spell Resistance:</strong> {s.sr ?? 'no'}
          </div>
        )}
        {s.desc && <p className="rules-desc">{s.desc}</p>}
      </div>
    );
  }
  if (record.kind === 'equipment') {
    const e = record as EquipmentRecord;
    const cost = baseCost(e);
    return (
      <div className="rules-body small-text">
        <div className="rules-kv">
          {cost !== null && (
            <span>
              <strong>Cost:</strong> {cost.toLocaleString('en-US')} gp
            </span>
          )}
          {e.weight !== null && (
            <span>
              <strong>Weight:</strong> {e.weight} lb
            </span>
          )}
          {e.slot && e.slot !== 'none' && (
            <span>
              <strong>Slot:</strong> {e.slot}
            </span>
          )}
          {e.cl !== null && (
            <span>
              <strong>CL:</strong> {e.cl} (Identify DC {15 + e.cl})
            </span>
          )}
          {e.aura && (
            <span>
              <strong>Aura:</strong> {e.aura}
            </span>
          )}
        </div>
        {e.damage && (
          <div>
            <strong>Weapon:</strong> {e.damage}
            {e.critMult ? ` (×${e.critMult})` : ''}
            {e.range ? ` · Range ${e.range} ft.` : ''}
            {e.wield ? ` · ${e.wield}` : ''}
          </div>
        )}
        {e.acBonus !== null && (
          <div>
            <strong>Armor / Shield:</strong> AC +{e.acBonus}
            {e.maxDex !== null ? ` · Max Dex +${e.maxDex}` : ''}
            {e.acp !== null ? ` · ACP ${e.acp}` : ''}
            {e.asf !== null ? ` · ASF ${e.asf}%` : ''}
          </div>
        )}
        {e.types.length > 0 && <div className="muted">Types: {e.types.join(', ')}</div>}
        {e.desc && <p className="rules-desc">{e.desc}</p>}
      </div>
    );
  }
  if (record.kind === 'feat' || record.kind === 'ability') {
    const f = record as FeatRecord;
    return (
      <div className="rules-body small-text">
        {f.types.length > 0 && (
          <div>
            <strong>Type:</strong> {f.types.join(', ')}
          </div>
        )}
        {f.prereqs && (
          <div>
            <strong>Prerequisites:</strong> {f.prereqs}
          </div>
        )}
        {f.benefit && <p className="rules-desc">{f.benefit}</p>}
        {f.desc && f.desc !== f.benefit && <p className="rules-desc">{f.desc}</p>}
      </div>
    );
  }
  if (record.kind === 'deity') {
    return (
      <div className="rules-body small-text">
        {record.alignment && (
          <div>
            <strong>Alignment:</strong> {record.alignment}
          </div>
        )}
        {record.favoredWeapon && (
          <div>
            <strong>Favored Weapon:</strong> {record.favoredWeapon}
          </div>
        )}
        {record.domains.length > 0 && (
          <div>
            <strong>Domains:</strong> {record.domains.join(', ')}
          </div>
        )}
        {record.symbol && (
          <div>
            <strong>Symbol:</strong> {record.symbol}
          </div>
        )}
        {record.desc && <p className="rules-desc">{record.desc}</p>}
      </div>
    );
  }
  if (record.kind === 'class') {
    const babLabel = record.bab === 'full' ? 'Full' : record.bab === 'threeQuarter' ? '¾' : record.bab === 'half' ? '½' : '—';
    return (
      <div className="rules-body small-text">
        <div className="rules-kv">
          {record.hd && (
            <span>
              <strong>HD:</strong> d{record.hd}
            </span>
          )}
          <span>
            <strong>BAB:</strong> {babLabel}
          </span>
          <span>
            <strong>Good saves:</strong> {record.goodSaves.length ? record.goodSaves.map((s) => s[0]!.toUpperCase() + s.slice(1)).join(', ') : 'None'}
          </span>
          {record.skillRanks !== null && (
            <span>
              <strong>Skill ranks:</strong> {record.skillRanks} + Int
            </span>
          )}
        </div>
        {record.classSkills.length > 0 && (
          <div>
            <strong>Class skills:</strong> {record.classSkills.join(', ')}
          </div>
        )}
        {record.desc && <p className="rules-desc">{record.desc}</p>}
      </div>
    );
  }
  if (record.kind === 'race') {
    const mods = Object.entries(record.abilityMods)
      .map(([k, v]) => `${v! >= 0 ? '+' : ''}${v} ${k}`)
      .join(', ');
    const skills = Object.entries(record.skillBonuses)
      .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`)
      .join(', ');
    return (
      <div className="rules-body small-text">
        <div className="rules-kv">
          {record.size && (
            <span>
              <strong>Size:</strong> {record.size}
            </span>
          )}
          {record.speed !== null && (
            <span>
              <strong>Speed:</strong> {record.speed} ft{record.steady ? ' (steady)' : ''}
            </span>
          )}
          <span>
            <strong>Abilities:</strong> {record.anyPlusTwo ? '+2 to one ability' : mods || '—'}
          </span>
        </div>
        {(record.darkvision > 0 || record.lowLight) && (
          <div>
            <strong>Senses:</strong> {[record.darkvision > 0 ? `Darkvision ${record.darkvision} ft` : null, record.lowLight ? 'Low-light vision' : null].filter(Boolean).join(', ')}
          </div>
        )}
        {skills && (
          <div>
            <strong>Racial skill bonuses:</strong> {skills}
          </div>
        )}
        {record.desc && <p className="rules-desc">{record.desc}</p>}
      </div>
    );
  }
  return <div className="rules-body small-text">{record.desc && <p className="rules-desc">{record.desc}</p>}</div>;
}

function CustomDetails({ custom }: { custom: CustomRule }) {
  return (
    <div className="rules-body small-text">
      {Object.entries(custom.fields).map(([k, v]) => (
        <div key={k}>
          <strong>{k}:</strong> {v}
        </div>
      ))}
      {(custom.cost !== null || custom.weight !== null || custom.cl !== null) && (
        <div className="rules-kv">
          {custom.cost !== null && (
            <span>
              <strong>Cost:</strong> {custom.cost.toLocaleString('en-US')} gp
            </span>
          )}
          {custom.weight !== null && (
            <span>
              <strong>Weight:</strong> {custom.weight} lb
            </span>
          )}
          {custom.cl !== null && (
            <span>
              <strong>CL:</strong> {custom.cl} (DC {15 + custom.cl})
            </span>
          )}
        </div>
      )}
      {custom.text && <p className="rules-desc">{custom.text}</p>}
    </div>
  );
}
