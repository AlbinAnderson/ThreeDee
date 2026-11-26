/**
 * The action system.
 *
 * Every change to game state is an `Action` ({ type, payload }). Each action
 * type is described exactly once by an `ActionDef`, which bundles:
 *   - schema:    zod schema for the payload (validates untrusted network input)
 *   - authorize: who may perform it (runs on the client for instant feedback
 *                and on the server as the source of truth)
 *   - prepare:   optional server-only step that enriches the payload
 *                (e.g. performing a dice roll so clients can't fake results)
 *   - apply:     the reducer, written as an immer mutation of a draft
 *
 * Both client and server run the very same `apply`, which is what keeps
 * everyone's state identical.
 */
import type { Draft } from 'immer';
import type { z } from 'zod';
import type { GameState, User, UserId } from '../state';

export interface Action<T extends string = string, P = unknown> {
  type: T;
  payload: P;
}

export interface ActionMeta {
  /** Who performed the action ('system' for server-originated actions). */
  userId: UserId;
  /** Server timestamp (ms since epoch). */
  ts: number;
}

export interface AuthContext {
  state: GameState;
  user: User;
}

export interface PrepareContext extends AuthContext {
  /** Uniform random integer in [0, maxExclusive). Cryptographically secure on the server. */
  random: (maxExclusive: number) => number;
}

/** `true` when allowed, otherwise a human readable reason. */
export type AuthResult = true | string;

export interface ActionSpec<P> {
  /**
   * Whether clients apply the action locally before the server confirms it.
   * Disable for actions whose outcome only the server can know (dice rolls).
   * Default: true.
   */
  optimistic?: boolean;
  authorize: (ctx: AuthContext, payload: P) => AuthResult;
  prepare?: (ctx: PrepareContext, payload: P) => P;
  /**
   * Server-side: whether a connected user receives this action (evaluated
   * against the state *before* it is applied). Default: everyone. The author
   * always receives their own action. An action with a restricted audience
   * must only touch data that the module's redactor hides from excluded users,
   * otherwise their copy of the state drifts.
   */
  audience?: (viewer: User, payload: P, ctx: { state: GameState; meta: ActionMeta }) => boolean;
  apply: (draft: Draft<GameState>, payload: P, meta: ActionMeta) => void;
}

export interface ActionDef<T extends string = string, P = unknown> extends ActionSpec<P> {
  type: T;
  schema: z.ZodType<P>;
  /** Typed action creator. */
  create: (payload: P) => Action<T, P>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyActionDef = ActionDef<string, any>;

export function defineAction<T extends string, S extends z.ZodType>(
  type: T,
  schema: S,
  spec: ActionSpec<z.output<S>>,
): ActionDef<T, z.output<S>> {
  return {
    ...spec,
    type,
    schema: schema as unknown as z.ZodType<z.output<S>>,
    create: (payload) => ({ type, payload }),
  };
}

/** A feature module's actions: a record of action definitions. */
export type ActionModule = Record<string, AnyActionDef>;

/**
 * Removes data a viewer may not see from a state snapshot (mutates a draft).
 * Runs on the server before sending a snapshot to each client.
 */
export type Redactor = (draft: Draft<GameState>, viewer: User) => void;

export interface GameModule<A extends ActionModule = ActionModule> {
  actions: A;
  redact?: Redactor;
}

/** Union of the concrete action objects of a module. */
export type ModuleActions<M> = {
  [K in keyof M]: M[K] extends ActionDef<infer T, infer P> ? Action<T, P> : never;
}[keyof M];
