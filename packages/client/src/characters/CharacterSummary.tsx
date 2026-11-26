/** Read-only overview of an imported PCGen build (used by the import preview and the Characters panel). */
import { useMemo } from 'react';
import { classSummary, totalLevel, type PcgenCharacter } from '@vtt/shared';

const STAT_ORDER = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const mod = (score: number) => Math.floor((score - 10) / 2);
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

export function CharacterSummary({ build, compact = false }: { build: PcgenCharacter; compact?: boolean }) {
  const stats = useMemo(
    () =>
      Object.entries(build.attributes.stats).sort(
        ([a], [b]) => (STAT_ORDER.indexOf(a) + 1 || 99) - (STAT_ORDER.indexOf(b) + 1 || 99),
      ),
    [build],
  );
  const abilitiesByCategory = useMemo(() => {
    const groups = new Map<string, string[]>();
    // PCGen 6 files say CATEGORY:FEAT; older ones use FEAT: lines. Show both as "Feats".
    const groupName = (category: string) => (category.toUpperCase() === 'FEAT' ? 'Feats' : category);
    for (const a of build.abilities) {
      const label = `${a.key}${a.appliedTo.length ? ` (${a.appliedTo.join(', ')})` : ''}`;
      const g = groupName(a.category);
      groups.set(g, [...(groups.get(g) ?? []), label]);
    }
    for (const f of build.legacyFeats) groups.set('Feats', [...(groups.get('Feats') ?? []), f]);
    return [...groups.entries()];
  }, [build]);
  const spellsByClass = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const s of build.spells.entries) {
      const key = `${s.className ?? 'Spells'}${s.book ? ` · ${s.book}` : ''}`;
      groups.set(key, [...(groups.get(key) ?? []), `${s.spellName}${s.level !== null ? ` (${s.level})` : ''}`]);
    }
    return [...groups.entries()];
  }, [build]);
  const skills = build.skills.filter((s) => s.totalRanks > 0).sort((a, b) => a.name.localeCompare(b.name));
  const hpRolled = build.classLevels.reduce((s, l) => s + (l.hitPoints ?? 0), 0);
  const a = build.attributes;

  return (
    <div className="char-summary">
      <div className="char-identity">
        <div>
          <strong>{[a.race, classSummary(build)].filter(Boolean).join(' · ')}</strong>
        </div>
        <div className="muted small-text">
          {[
            `Level ${totalLevel(build)}`,
            a.alignment,
            a.deity?.name && `Deity: ${a.deity.name}`,
            build.experience.xp !== null && `${build.experience.xp} XP`,
            build.bio.playerName && `Player: ${build.bio.playerName}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>

      {stats.length > 0 && (
        <div className="char-stats">
          {stats.map(([k, v]) => (
            <div key={k} className="char-stat">
              <span className="char-stat-name">{k}</span>
              <span className="char-stat-score">{v}</span>
              <span className="char-stat-mod">{signed(mod(v))}</span>
            </div>
          ))}
        </div>
      )}
      <p className="muted small-text">
        Base scores from PCGen (racial and item bonuses are applied by the character sheet in a later update). Rolled HP:{' '}
        {hpRolled}.
      </p>

      <Section title={`Skills (${skills.length} with ranks)`} open={!compact}>
        <ul className="char-chips">
          {skills.map((s) => (
            <li key={s.name}>
              {s.name} <span className="muted">{s.totalRanks}</span>
            </li>
          ))}
        </ul>
      </Section>
      {abilitiesByCategory.map(([category, items]) => (
        <Section key={category} title={`${category} (${items.length})`} open={!compact}>
          <ul className="char-chips">
            {items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Section>
      ))}
      <Section title={`Equipment (${build.equipment.length})`}>
        <ul className="char-chips">
          {build.equipment.map((e, i) => (
            <li key={i}>
              {e.name}
              {e.quantity && e.quantity !== 1 ? <span className="muted"> ×{e.quantity}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
      {spellsByClass.map(([key, spells]) => (
        <Section key={key} title={`${key} (${spells.length})`}>
          <ul className="char-chips">
            {spells.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Section>
      ))}
      {a.languages.length > 0 && (
        <Section title={`Languages (${a.languages.length})`}>
          <p className="small-text">{a.languages.join(', ')}</p>
        </Section>
      )}
      {build.notes.length > 0 && (
        <Section title={`PCGen notes (${build.notes.length})`}>
          {build.notes.map((n, i) => (
            <div key={i} className="small-text">
              <strong>{n.name}</strong>
              {n.value && <div className="notes-readonly">{n.value}</div>}
            </div>
          ))}
        </Section>
      )}
      {build.warnings.length > 0 && (
        <Section title={`⚠ Import warnings (${build.warnings.length})`} open>
          <ul className="small-text warning-list">
            {build.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="inspector-section" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
