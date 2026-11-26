/**
 * Local ruler + broadcasting it to the table, throttled to ~20 updates/s.
 * Used by the ruler tool and by token dragging.
 */
import type { Point } from '@vtt/shared';
import { sendEphemeral } from '../state/session';
import { useInteraction } from './interactionStore';

const INTERVAL_MS = 50;
let lastSent = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { sceneId: string; points: [number, number, number, number] } | null = null;

function flush() {
  timer = null;
  if (!pending) return;
  sendEphemeral({ kind: 'ruler', ...pending });
  pending = null;
  lastSent = Date.now();
}

export function setSharedRuler(sceneId: string, from: Point, to: Point) {
  useInteraction.getState().setRuler({ sceneId, from, to });
  pending = { sceneId, points: [from.x, from.y, to.x, to.y] };
  const wait = INTERVAL_MS - (Date.now() - lastSent);
  if (wait <= 0) flush();
  else if (!timer) timer = setTimeout(flush, wait);
}

export function clearSharedRuler(sceneId: string) {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  useInteraction.getState().setRuler(null);
  sendEphemeral({ kind: 'ruler', sceneId, points: null });
}
