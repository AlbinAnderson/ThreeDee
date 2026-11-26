/**
 * Wire protocol between client and server (JSON over a single WebSocket).
 *
 *   client -> server: join, action, ephemeral, request
 *   server -> client: welcome (full snapshot), action (confirmed, sequenced),
 *                     reject, presence, ephemeral, response, notice, error
 *
 * A second `welcome` may arrive at any time (e.g. after the GM restores a
 * snapshot); clients must replace their state with it.
 *
 * "Ephemeral" events (pings, cursors, ...) are relayed to other clients but
 * never stored in game state.
 */
import { z } from 'zod';
import type { Action, ActionMeta } from './actions/define';
import { IdSchema, UserNameSchema, type GameState, type User, type UserId } from './state';

export const RoomIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Room names may use lowercase letters, digits and dashes');

export const EphemeralEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ping'), sceneId: IdSchema, x: z.number(), y: z.number() }),
]);
export type EphemeralEvent = z.infer<typeof EphemeralEventSchema>;

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    roomId: RoomIdSchema,
    userId: IdSchema,
    name: UserNameSchema,
    asGm: z.boolean(),
    gmPassword: z.string().max(200).optional(),
  }),
  z.object({
    t: z.literal('action'),
    clientId: z.string().min(1).max(64),
    action: z.object({ type: z.string().max(64), payload: z.unknown() }),
  }),
  z.object({ t: z.literal('ephemeral'), event: EphemeralEventSchema }),
  z.object({ t: z.literal('request'), reqId: z.string().min(1).max(64), op: z.string().max(64), args: z.unknown() }),
]);
export type ClientMessage = z.input<typeof ClientMessageSchema>;
export type JoinMessage = Extract<ClientMessage, { t: 'join' }>;

export type ServerMessage =
  | { t: 'welcome'; self: User; state: GameState; seq: number }
  | { t: 'action'; seq: number; action: Action; meta: ActionMeta; clientId?: string }
  | { t: 'reject'; clientId: string; reason: string }
  | { t: 'presence'; online: UserId[] }
  | { t: 'ephemeral'; from: UserId; event: EphemeralEvent }
  | { t: 'response'; reqId: string; ok: true; data: unknown }
  | { t: 'response'; reqId: string; ok: false; error: string }
  /** Informational message to show the user (e.g. "the GM restored a snapshot"). */
  | { t: 'notice'; message: string }
  | { t: 'error'; message: string; fatal?: boolean };
