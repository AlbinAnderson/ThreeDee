import { isGm, type GameState, type Scene, type User } from '@vtt/shared';
import { getSelf, useGameStore } from './gameStore';
import { useUi } from './uiStore';

/**
 * Select from the live game state. The selector MUST return a stable value
 * (an existing object/primitive). For derived arrays, select the source
 * record and derive with useMemo.
 */
export function useGame<T>(selector: (state: GameState) => T): T {
  return useGameStore((s) => selector(s.view!));
}

export function useSelf(): User {
  return useGameStore((s) => s.view!.users[s.selfId!]!);
}

export function useIsGm(): boolean {
  return useGameStore((s) => {
    const self = s.view?.users[s.selfId ?? ''];
    return !!self && isGm(self);
  });
}

/** Scene the local user is looking at: GM's local override, else the active scene. */
export function useCurrentSceneId(): string | null {
  const gm = useIsGm();
  const viewed = useUi((s) => s.viewedSceneId);
  return useGame((s) => (gm && viewed && s.scenes[viewed] ? viewed : s.activeSceneId));
}

export function useCurrentScene(): Scene | null {
  const id = useCurrentSceneId();
  return useGame((s) => (id ? (s.scenes[id] ?? null) : null));
}

/** Non-hook equivalent of useCurrentScene, for event handlers. */
export function getCurrentScene(): Scene | null {
  const view = useGameStore.getState().view;
  const self = getSelf();
  if (!view) return null;
  const viewed = useUi.getState().viewedSceneId;
  const id = self && isGm(self) && viewed && view.scenes[viewed] ? viewed : view.activeSceneId;
  return id ? (view.scenes[id] ?? null) : null;
}
