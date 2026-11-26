/**
 * Client helpers for acting on a character: rolls into chat (#18) and keeping
 * the linked token in sync (#17).
 */
import {
  canControlToken,
  characterSheetActions,
  combatActions,
  computeCharacterStats,
  signed,
  tokenActions,
  type Character,
  type CharacterRuntime,
  type CharacterSheet,
  type Token,
} from '@vtt/shared';
import { rollToChat } from '../panels/ChatPanel';
import { dispatch } from '../state/dispatch';
import { getSelf, useGameStore } from '../state/gameStore';

/** Roll d20 + bonus into chat using the current chat mode, labelled with the character's name. */
export function rollCheck(c: Character, label: string, bonus: number) {
  return rollToChat(`1d20${signed(bonus)}`, `${c.name}: ${label}`);
}

/**
 * Initiative: if the character's token is in the turn order, roll there (it
 * updates the tracker and posts to chat); otherwise just roll into chat.
 */
export function rollInitiative(c: Character, bonus: number) {
  const state = useGameStore.getState().view;
  const combatant = c.tokenId ? state?.combat.combatants.find((x) => x.tokenId === c.tokenId) : undefined;
  if (!combatant) return rollCheck(c, 'Initiative', bonus);
  if (combatant.modifier !== bonus) dispatch(combatActions.update.create({ id: combatant.id, changes: { modifier: bonus } }));
  return dispatch(combatActions.rollInitiative.create({ ids: [combatant.id] }));
}

function linkedToken(c: Character): Token | undefined {
  const state = useGameStore.getState().view;
  const self = getSelf();
  const token = c.tokenId ? state?.tokens[c.tokenId] : undefined;
  return token && self && canControlToken(self, token) ? token : undefined;
}

/** Push the character's numbers onto its token, if linked and you control the token. */
export function syncLinkedToken(c: Character) {
  if (linkedToken(c)) dispatch(characterSheetActions.syncToken.create({ id: c.id }));
}

export function updateSheet(c: Character, changes: Partial<CharacterSheet>) {
  if (dispatch(characterSheetActions.updateSheet.create({ id: c.id, changes }))) syncLinkedToken(c);
}

export function updateRuntime(c: Character, changes: Partial<CharacterRuntime>) {
  if (dispatch(characterSheetActions.updateRuntime.create({ id: c.id, changes }))) syncLinkedToken(c);
}

/**
 * Set current/temp HP. While linked, the token holds the live HP (so the map
 * bar, damage buttons and sheet agree); otherwise it's stored on the character.
 */
export function setHp(c: Character, next: { current: number; temp: number; nonlethal: number }, maxHp: number) {
  const token = linkedToken(c);
  if (token) {
    dispatch(tokenActions.update.create({ id: token.id, changes: { hp: { value: next.current, max: token.hp?.max ?? maxHp, temp: next.temp } } }));
    if ((c.runtime.hp?.nonlethal ?? 0) !== next.nonlethal) {
      dispatch(characterSheetActions.updateRuntime.create({ id: c.id, changes: { hp: { ...next } } }));
    }
    return;
  }
  dispatch(characterSheetActions.updateRuntime.create({ id: c.id, changes: { hp: next } }));
}

/** Initiative modifier for a token, if it is linked to a character you can see. */
export function initiativeForToken(tokenId: string): { modifier: number; name: string } | undefined {
  const state = useGameStore.getState().view;
  const c = state && Object.values(state.characters).find((x) => x.tokenId === tokenId);
  return c ? { modifier: computeCharacterStats(c).initiative.total, name: c.name } : undefined;
}
