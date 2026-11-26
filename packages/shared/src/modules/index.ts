/**
 * Registry of feature modules. To add a feature: create a module file
 * exporting a record of `defineAction(...)` definitions (and optionally a
 * redactor for private data) and add it here. Types (`GameAction`), server
 * handling and redaction update automatically.
 */
import type { GameModule, ModuleActions } from '../actions/define';
import { chatActions } from './chat';
import { drawingActions } from './drawings';
import { lootActions, redactLoot } from './loot';
import { notesActions, redactNotes } from './notes';
import { sceneActions } from './scenes';
import { tokenActions } from './tokens';
import { userActions } from './users';

export const gameModules = {
  users: { actions: userActions },
  scenes: { actions: sceneActions },
  tokens: { actions: tokenActions },
  drawings: { actions: drawingActions },
  chat: { actions: chatActions },
  notes: { actions: notesActions, redact: redactNotes },
  loot: { actions: lootActions, redact: redactLoot },
} satisfies Record<string, GameModule>;

type Modules = typeof gameModules;

/** Union of every action the game understands. */
export type GameAction = { [K in keyof Modules]: ModuleActions<Modules[K]['actions']> }[keyof Modules];

export { chatActions, drawingActions, lootActions, notesActions, sceneActions, tokenActions, userActions };
export { canDeleteDrawing } from './drawings';
