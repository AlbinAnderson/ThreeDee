/**
 * Pure visibility helpers for tokens shown outside the map (no board/camera imports, so map layers can use them).
 */
import { isGm, type Character, type GameState, type Token, type User } from '@vtt/shared';

/** Same rule as the HP bar drawn on the map: GM, owners, or tokens whose HP is public. */
export function canSeeTokenHp(self: User, token: Token): boolean {
  return !!token.hp && (isGm(self) || token.hpVisible || token.ownerIds.includes(self.id));
}

/** The character (visible to you) linked to `tokenId`, if any. */
export function characterForToken(state: Pick<GameState, 'characters'>, tokenId: string | null | undefined): Character | undefined {
  if (!tokenId) return undefined;
  return Object.values(state.characters).find((c) => c.tokenId === tokenId);
}

/**
 * Whether the local user can jump to this token: players only on the live scene and never to
 * hidden tokens; the GM anywhere (switching their local scene view if needed).
 */
export function canFocusToken(self: User, token: Token, currentSceneId: string | null): boolean {
  if (isGm(self)) return true;
  return !token.hidden && token.sceneId === currentSceneId;
}
