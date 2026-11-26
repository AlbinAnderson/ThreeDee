/**
 * Registry of feature modules. To add a feature: create a module file
 * exporting a record of `defineAction(...)` definitions and add it here.
 * Types (`GameAction`) and runtime lookup update automatically.
 */
import type { ModuleActions } from '../actions/define';
import { chatActions } from './chat';
import { sceneActions } from './scenes';
import { tokenActions } from './tokens';
import { userActions } from './users';

export const gameModules = {
  users: userActions,
  scenes: sceneActions,
  tokens: tokenActions,
  chat: chatActions,
};

type Modules = typeof gameModules;

/** Union of every action the game understands. */
export type GameAction = { [K in keyof Modules]: ModuleActions<Modules[K]> }[keyof Modules];

export { chatActions, sceneActions, tokenActions, userActions };
