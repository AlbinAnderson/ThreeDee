/**
 * Shared client helpers for showing and focusing tokens from sidebar panels.
 */
export { canFocusToken, canSeeTokenHp, characterForToken } from './tokenVisibility';
import { canFocusToken } from './tokenVisibility';
import { centerOnToken, moveCamera } from '../board/Board';
import { useCharactersUi } from '../characters/store';
import { getCurrentScene } from '../state/hooks';
import { getSelf, useGameStore } from '../state/gameStore';
import { useUi } from '../state/uiStore';

/**
 * Select a token and center the camera on it. Returns false when the viewer may not jump there.
 */
export function focusToken(tokenId: string, opts: { select?: boolean } = {}): boolean {
  const view = useGameStore.getState().view;
  const self = getSelf();
  const token = view?.tokens[tokenId];
  if (!view || !self || !token) return false;
  const current = getCurrentScene();
  if (!canFocusToken(self, token, current?.id ?? null)) return false;
  const scene = view.scenes[token.sceneId];
  if (!scene) return false;

  const ui = useUi.getState();
  const switching = current?.id !== token.sceneId;
  const camera = centerOnToken(token, scene, ui.viewport, ui.camera.zoom);
  if (switching) {
    // GM only (checked above). Following the live scene again when that's where the token is.
    ui.setViewedScene(token.sceneId === view.activeSceneId ? null : token.sceneId);
  }
  if (opts.select !== false) useUi.getState().setSelection([token.id]);
  if (ui.viewport.width > 0 && ui.viewport.height > 0) moveCamera(camera, switching ? { sceneId: token.sceneId, instant: true } : {});
  return true;
}

/** Open a character on the Characters sidebar panel (or the wide pop-out sheet). */
export function openCharacterSheet(characterId: string, opts: { popout?: boolean } = {}) {
  if (opts.popout) {
    useCharactersUi.setState({ selectedId: characterId, poppedOut: true });
    return;
  }
  useCharactersUi.setState({ selectedId: characterId, tab: 'sheet', poppedOut: false });
  useUi.getState().setSidebarPanel('characters');
}
