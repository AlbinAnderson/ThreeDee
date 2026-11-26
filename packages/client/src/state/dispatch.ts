import { getActionDef, newId, type GameAction } from '@vtt/shared';
import { gameStore, getSelf, useGameStore } from './gameStore';
import { notify } from './notifications';
import { send } from './session';

/**
 * Send a game action to the server. Validates and authorizes locally first so
 * the user gets instant feedback, then applies it optimistically (unless the
 * action opts out). Returns false if the action was not sent.
 */
export function dispatch(action: GameAction): boolean {
  const view = useGameStore.getState().view;
  const self = getSelf();
  const def = getActionDef(action.type);
  if (!view || !self || !def) return false;

  const parsed = def.schema.safeParse(action.payload);
  if (!parsed.success) {
    notify(parsed.error.issues[0]?.message ?? 'Invalid input');
    return false;
  }
  const auth = def.authorize({ state: view, user: self }, parsed.data);
  if (auth !== true) {
    notify(auth);
    return false;
  }

  const clientId = newId();
  if (!send({ t: 'action', clientId, action })) {
    notify('Not connected to the server');
    return false;
  }
  if (def.optimistic !== false) {
    gameStore.addPending({ clientId, action, meta: { userId: self.id, ts: Date.now() } });
  }
  return true;
}

/** Check whether the current user could perform an action, without sending it. */
export function canDispatch(action: GameAction): boolean {
  const view = useGameStore.getState().view;
  const self = getSelf();
  const def = getActionDef(action.type);
  return !!(view && self && def && def.authorize({ state: view, user: self }, action.payload) === true);
}
