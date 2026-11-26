import type { ComponentType } from 'react';
import type { EphemeralEvent, GameAction, GameState, Point, Scene, User } from '@vtt/shared';
import type { useInteraction } from '../board/interactionStore';
import type { Camera, useUi } from '../state/uiStore';

/** A pointer event on the board, already converted to scene coordinates. */
export interface BoardPointer {
  world: Point;
  /** Token under the pointer, if any. */
  tokenId: string | null;
  /** Drawing under the pointer, if any (only when no token is). */
  drawingId: string | null;
  /** Area template under the pointer, if any (only when no token/drawing is). */
  templateId: string | null;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

/** Everything a tool may touch. Built fresh for every event, so it is never stale. */
export interface ToolContext {
  scene: Scene;
  game: GameState;
  self: User;
  camera: Camera;
  dispatch: (action: GameAction) => boolean;
  sendEphemeral: (event: EphemeralEvent) => void;
  ui: ReturnType<typeof useUi.getState>;
  interaction: ReturnType<typeof useInteraction.getState>;
}

/**
 * Board tools receive left-button pointer events (right/middle button and
 * space+drag always pan). `S` is per-gesture scratch state created by
 * `createState` when the tool is activated.
 */
export interface Tool<S = unknown> {
  id: string;
  label: string;
  /** Short glyph shown on the toolbar button. */
  icon: string;
  hotkey?: string;
  gmOnly?: boolean;
  cursor?: string;
  /** Settings shown under the toolbar while the tool is active. */
  Options?: ComponentType;
  createState(): S;
  /** Return 'pan' to hand the gesture to the camera instead. */
  onPointerDown?(p: BoardPointer, ctx: ToolContext, state: S): void | 'pan';
  onPointerMove?(p: BoardPointer, ctx: ToolContext, state: S): void;
  onPointerUp?(p: BoardPointer, ctx: ToolContext, state: S): void;
  /** Called when the gesture is interrupted (tool switch, pointer lost). */
  onCancel?(ctx: ToolContext, state: S): void;
}

export function defineTool<S>(tool: Tool<S>): Tool<S> {
  return tool;
}
