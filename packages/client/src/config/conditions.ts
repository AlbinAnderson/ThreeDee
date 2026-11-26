/**
 * Preset status markers offered in the token inspector. Anything else can be
 * typed in as a custom condition. Edit freely: tokens just store the names.
 */
export interface ConditionPreset {
  name: string;
  /** Short glyph drawn on the token. */
  icon: string;
  color: string;
}

export const CONDITION_PRESETS: ConditionPreset[] = [
  { name: 'Blinded', icon: '◉', color: '#555555' },
  { name: 'Confused', icon: '?', color: '#c77dff' },
  { name: 'Dazed', icon: '✦', color: '#ffd43b' },
  { name: 'Deafened', icon: '♪', color: '#868e96' },
  { name: 'Dying', icon: '✚', color: '#c92a2a' },
  { name: 'Entangled', icon: '⌇', color: '#2f9e44' },
  { name: 'Exhausted', icon: 'Z', color: '#5c7cfa' },
  { name: 'Fatigued', icon: 'z', color: '#748ffc' },
  { name: 'Flat-footed', icon: '⊥', color: '#e8590c' },
  { name: 'Frightened', icon: '!', color: '#f76707' },
  { name: 'Grappled', icon: '⊗', color: '#d9480f' },
  { name: 'Helpless', icon: '∅', color: '#495057' },
  { name: 'Invisible', icon: '◌', color: '#a5d8ff' },
  { name: 'Nauseated', icon: '~', color: '#82c91e' },
  { name: 'Paralyzed', icon: '⊘', color: '#1c7ed6' },
  { name: 'Prone', icon: '↓', color: '#a0522d' },
  { name: 'Shaken', icon: '≈', color: '#fab005' },
  { name: 'Sickened', icon: '☣', color: '#94d82d' },
  { name: 'Stable', icon: '♥', color: '#40c057' },
  { name: 'Staggered', icon: '⟂', color: '#f08c00' },
  { name: 'Stunned', icon: '★', color: '#fcc419' },
  { name: 'Unconscious', icon: '◒', color: '#343a40' },
  { name: 'Dead', icon: '☠', color: '#000000' },
  { name: 'Concentrating', icon: '◎', color: '#4dabf7' },
  { name: 'Hasted', icon: '»', color: '#20c997' },
  { name: 'Slowed', icon: '«', color: '#adb5bd' },
  { name: 'Raging', icon: '▲', color: '#e03131' },
  { name: 'Blessed', icon: '✧', color: '#ffe066' },
];

const BY_NAME = new Map(CONDITION_PRESETS.map((c) => [c.name.toLowerCase(), c]));

/** Display info for any condition name (custom ones get a generated color). */
export function conditionStyle(name: string): ConditionPreset {
  const preset = BY_NAME.get(name.toLowerCase());
  if (preset) return preset;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { name, icon: name.slice(0, 1).toUpperCase(), color: `hsl(${h % 360} 60% 45%)` };
}

export function hpColor(value: number, max: number): string {
  const f = max > 0 ? value / max : 0;
  if (f > 0.5) return '#40c057';
  if (f > 0.25) return '#fab005';
  return '#fa5252';
}
