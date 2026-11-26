/** Quick switches for combat options (Power Attack, Fight defensively...) that change attacks and AC. */
import {
  acrobaticsRanks,
  activeToggles,
  availableToggles,
  canManageCharacter,
  characterSheetActions,
  setToggle,
  toggleStep,
  type Character,
  type CharacterStats,
} from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { useSelf } from '../state/hooks';

export function CombatToggles({ character: c, stats }: { character: Character; stats: CharacterStats }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const toggles = availableToggles(c);
  const active = activeToggles(c);
  const step = toggleStep(stats.bab.total);
  const ranks = acrobaticsRanks(c);
  if (!toggles.length) return null;
  return (
    <div className="combat-toggles" role="group" aria-label="Combat options">
      {toggles.map((t) => {
        const on = active.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            className={`small toggle-chip${on ? ' active' : ''}`}
            aria-pressed={on}
            disabled={!manage}
            title={t.describe(step, ranks)}
            onClick={() =>
              dispatch(characterSheetActions.updateRuntime.create({ id: c.id, changes: { toggles: setToggle(c.runtime.toggles, t.id, !on) } }))
            }
          >
            {t.label}
          </button>
        );
      })}
      {active.has('totalDefense') && <span className="warn-text small-text">Total defense: no attacks this round.</span>}
    </div>
  );
}
