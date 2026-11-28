/** Sheet settings: everything the .pcg file doesn't say, or that you want to override. */
import { useMemo } from 'react';
import {
  computeCharacterStats,
  lookupClass,
  lookupRace,
  normalizeName,
  raceDataFromSnapshot,
  resolveClassName,
  saveName,
  SIZES,
  STAT_KEYS,
  type Character,
  type MiscTarget,
  type SaveKey,
} from '@vtt/shared';
import { CheckboxField, OptionalNumberField, SelectField } from '../components/fields';
import { updateSheet } from './characterActions';

const MISC: { key: MiscTarget; label: string }[] = [
  { key: 'hp', label: 'Max HP (favored class…)' },
  { key: 'ac', label: 'AC (misc)' },
  { key: 'natural', label: 'Natural armor' },
  { key: 'deflection', label: 'Deflection' },
  { key: 'initiative', label: 'Initiative' },
  { key: 'fort', label: 'Fortitude' },
  { key: 'ref', label: 'Reflex' },
  { key: 'will', label: 'Will' },
  { key: 'cmb', label: 'CMB' },
  { key: 'cmd', label: 'CMD' },
];

export function CharacterSettings({ character: c }: { character: Character }) {
  const stats = useMemo(() => computeCharacterStats(c), [c]);
  const race = lookupRace(c.build.attributes.race) ?? raceDataFromSnapshot(c.rulesData.race);
  const s = c.sheet;

  return (
    <div className="sheet-settings">
      <p className="muted small-text">
        These fill gaps in the PCGen file and are kept when you re-import. Leave a field blank to use the automatic value.
      </p>

      {race?.anyPlusTwo && (
        <SelectField
          label={`Racial +2 (${c.build.attributes.race})`}
          value={s.racialChoice ?? ''}
          options={[{ value: '', label: 'Not chosen' }, ...STAT_KEYS.map((k) => ({ value: k, label: k }))]}
          onCommit={(v) => updateSheet(c, { racialChoice: (v || null) as typeof s.racialChoice })}
        />
      )}

      <section>
        <h3>Classes</h3>
        {c.build.classes.map((k) => (
          <ClassChassisEditor key={k.name} character={c} className={k.name} />
        ))}
      </section>

      <section>
        <h3>Armor</h3>
        <p className="muted small-text">
          {stats.armor.worn.length ? `Detected from equipped gear: ${stats.armor.worn.join(', ')}.` : 'No armor detected in the equipped gear.'}
        </p>
        <div className="field-row">
          <OptionalNumberField label="Armor bonus" value={s.armorBonus} min={0} max={40} placeholder="auto" onCommit={(armorBonus) => updateSheet(c, { armorBonus })} />
          <OptionalNumberField label="Shield bonus" value={s.shieldBonus} min={0} max={40} placeholder="auto" onCommit={(shieldBonus) => updateSheet(c, { shieldBonus })} />
          <OptionalNumberField
            label="Max Dex"
            value={s.maxDex}
            min={0}
            max={20}
            placeholder={stats.armor.maxDex === null ? 'none' : `auto (${stats.armor.maxDex})`}
            onCommit={(maxDex) => updateSheet(c, { maxDex })}
          />
        </div>
      </section>

      <section>
        <h3>Body &amp; senses</h3>
        <div className="field-row">
          <SelectField
            label="Size"
            value={s.size ?? ''}
            options={[{ value: '', label: `Auto (${race?.size ?? 'Medium'})` }, ...SIZES.map((z) => ({ value: z, label: z }))]}
            onCommit={(v) => updateSheet(c, { size: (v || null) as typeof s.size })}
          />
          <OptionalNumberField label="Speed (ft)" value={s.speed} min={0} max={300} placeholder={`auto (${race?.speed ?? 30})`} onCommit={(speed) => updateSheet(c, { speed })} />
          <OptionalNumberField
            label="Darkvision (ft)"
            value={s.darkvision}
            min={0}
            max={600}
            placeholder={`auto (${race?.darkvision ?? 0})`}
            onCommit={(darkvision) => updateSheet(c, { darkvision })}
          />
        </div>
      </section>

      <section>
        <h3>Other bonuses</h3>
        <p className="muted small-text">Untyped extras the sheet doesn't calculate yet (gear, class features, favored class HP…).</p>
        <div className="misc-grid">
          {MISC.map(({ key, label }) => (
            <OptionalNumberField
              key={key}
              label={label}
              value={s.misc[key] ?? null}
              min={-100}
              max={1000}
              onCommit={(v) => {
                const misc = { ...s.misc };
                if (v) misc[key] = v;
                else delete misc[key];
                updateSheet(c, { misc });
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ClassChassisEditor({ character: c, className }: { character: Character; className: string }) {
  const resolved = resolveClassName(c, className);
  const known = lookupClass(resolved) ?? lookupClass(className) ?? c.rulesData.classes[normalizeName(className)];
  const custom = c.sheet.classChassis[className];
  const current = custom ?? known ?? { hd: 8, bab: 'threeQuarter' as const, goodSaves: [] as SaveKey[], prestige: false };

  function set(next: Partial<typeof current> | null) {
    const classChassis = { ...c.sheet.classChassis };
    if (next === null) delete classChassis[className];
    else classChassis[className] = { ...current, ...next };
    updateSheet(c, { classChassis });
  }

  return (
    <div className={`class-chassis${!known && !custom ? ' missing' : ''}`}>
      <div className="section-header">
        <strong>{className}</strong>
        {custom ? (
          known ? (
            <button type="button" className="link-button" onClick={() => set(null)}>
              Reset to rules
            </button>
          ) : null
        ) : known ? (
          <span className="muted small-text">from rules data</span>
        ) : (
          <span className="warn-text small-text">unknown class, fill in below</span>
        )}
      </div>
      <div className="field-row">
        <SelectField
          label="Hit die"
          value={String(current.hd)}
          options={['4', '6', '8', '10', '12'].map((v) => ({ value: v, label: `d${v}` }))}
          onCommit={(v) => set({ hd: Number(v) })}
        />
        <SelectField
          label="BAB"
          value={current.bab}
          options={[
            { value: 'full', label: 'Full' },
            { value: 'threeQuarter', label: '¾' },
            { value: 'half', label: '½' },
          ]}
          onCommit={(bab) => set({ bab })}
        />
      </div>
      <div className="field-row">
        {(['fort', 'ref', 'will'] as SaveKey[]).map((sv) => (
          <CheckboxField
            key={sv}
            label={`Good ${saveName(sv)}`}
            value={current.goodSaves.includes(sv)}
            onCommit={(on) => set({ goodSaves: on ? [...current.goodSaves, sv] : current.goodSaves.filter((x) => x !== sv) })}
          />
        ))}
      </div>
      <CheckboxField label="Prestige class" value={current.prestige} onCommit={(prestige) => set({ prestige })} />
    </div>
  );
}
