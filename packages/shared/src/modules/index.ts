/**
 * Registry of feature modules. To add a feature: create a module file
 * exporting a record of `defineAction(...)` definitions (and optionally a
 * redactor for private data) and add it here. Types (`GameAction`), server
 * handling and redaction update automatically.
 */
import type { GameModule, ModuleActions } from '../actions/define';
import { audioActions } from './audio';
import { chatActions, redactChat } from './chat';
import { combatActions } from './combat';
import { deckActions, redactDecks } from './decks';
import { drawingActions } from './drawings';
import { fogActions } from './fog';
import { handoutActions, redactHandouts } from './handouts';
import { lootActions, redactLoot } from './loot';
import { macroActions } from './macros';
import { notesActions, redactNotes } from './notes';
import { characterActions, characterSheetActions, redactCharacters } from './pf1e/characters';
import { inventoryActions } from './pf1e/inventory';
import { spellActions } from './pf1e/spells';
import { pf1eTurnActions, redactPf1eTurns } from './pf1e/turns';
import { sceneActions } from './scenes';
import { redactTables, tableActions } from './tables';
import { templateActions } from './templates';
import { tokenActions } from './tokens';
import { userActions } from './users';
import { lightActions, wallActions } from './vision';

export const gameModules = {
  users: { actions: userActions },
  scenes: { actions: sceneActions },
  tokens: { actions: tokenActions },
  drawings: { actions: drawingActions },
  fog: { actions: fogActions },
  chat: { actions: chatActions, redact: redactChat },
  combat: { actions: combatActions },
  notes: { actions: notesActions, redact: redactNotes },
  loot: { actions: lootActions, redact: redactLoot },
  handouts: { actions: handoutActions, redact: redactHandouts },
  macros: { actions: macroActions },
  audio: { actions: audioActions },
  tables: { actions: tableActions, redact: redactTables },
  decks: { actions: deckActions, redact: redactDecks },
  templates: { actions: templateActions },
  walls: { actions: wallActions },
  lights: { actions: lightActions },
  // ---- PF1e
  characters: { actions: characterActions, redact: redactCharacters },
  characterSheets: { actions: characterSheetActions },
  pf1eTurns: { actions: pf1eTurnActions, redact: redactPf1eTurns },
  inventory: { actions: inventoryActions },
  spells: { actions: spellActions },
} satisfies Record<string, GameModule>;

type Modules = typeof gameModules;

/** Union of every action the game understands. */
export type GameAction = { [K in keyof Modules]: ModuleActions<Modules[K]['actions']> }[keyof Modules];

export { audioActions, spellActions, characterActions, characterSheetActions, pf1eTurnActions, inventoryActions, chatActions, combatActions, deckActions, tableActions, drawingActions, fogActions, handoutActions, lightActions, macroActions, templateActions, wallActions, lootActions, notesActions, sceneActions, tokenActions, userActions };
export { canDeleteDrawing } from './drawings';
export { canSeeMessage, chatAudience, pushMessage, validateWhisper } from './chat';
export { canControlCombatant, combatantName, compareCombatants, isCombatantHidden } from './combat';
export { canDeleteTemplate, templateCells, templateContains } from './templates';
export { canSeeHandout } from './handouts';
export { canManageCharacter, canSeeCharacter } from './pf1e/characters';
export { characterPools, characterResources, type ResourcePool } from './pf1e/turns';
export { formatGpValue, isUnidentifiedLoot, parseGpValue } from './pf1e/inventory';
