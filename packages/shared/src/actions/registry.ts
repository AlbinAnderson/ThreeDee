import { produce } from 'immer';
import { gameModules, type GameAction } from '../modules';
import type { GameState } from '../state';
import type { Action, ActionMeta, AnyActionDef } from './define';

const registry = new Map<string, AnyActionDef>();
for (const mod of Object.values(gameModules)) {
  for (const def of Object.values(mod) as AnyActionDef[]) {
    if (registry.has(def.type)) throw new Error(`Duplicate action type "${def.type}"`);
    registry.set(def.type, def);
  }
}

export function getActionDef(type: string): AnyActionDef | undefined {
  return registry.get(type);
}

/** Pure reducer shared by client and server. Unknown actions are ignored. */
export function applyAction(state: GameState, action: Action, meta: ActionMeta): GameState {
  const def = registry.get(action.type);
  if (!def) return state;
  return produce(state, (draft) => {
    def.apply(draft, action.payload, meta);
  });
}

export type ParseResult = { ok: true; action: GameAction; def: AnyActionDef } | { ok: false; error: string };

/** Validate an untrusted `{ type, payload }` against the registered schemas. */
export function parseAction(raw: { type: string; payload: unknown }): ParseResult {
  const def = registry.get(raw.type);
  if (!def) return { ok: false, error: `Unknown action "${raw.type}"` };
  const result = def.schema.safeParse(raw.payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    return { ok: false, error: `Invalid ${raw.type}: ${issue?.message ?? 'bad payload'}${where}` };
  }
  return { ok: true, action: { type: def.type, payload: result.data } as GameAction, def };
}
