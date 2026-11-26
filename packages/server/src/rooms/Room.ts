import { randomInt } from 'node:crypto';
import {
  applyAction,
  parseAction,
  userActions,
  type Action,
  type ActionMeta,
  type EphemeralEvent,
  type GameAction,
  type GameState,
  type ServerMessage,
  type User,
} from '@vtt/shared';
import type { RoomStore } from '../persistence/RoomStore';
import { config } from '../config';

/** A connected socket, independent of the transport. */
export interface Client {
  readonly id: string;
  user: User | null;
  room: Room | null;
  send(msg: ServerMessage): void;
}

export const SYSTEM_USER_ID = 'system';

/**
 * Authoritative state for one game room. All mutations go through `commit`,
 * which applies the shared reducer, sequences the action and broadcasts it.
 */
export class Room {
  private seq = 0;
  private readonly clients = new Set<Client>();
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    readonly id: string,
    private state: GameState,
    private readonly store: RoomStore,
  ) {}

  get snapshot(): GameState {
    return this.state;
  }

  get clientCount() {
    return this.clients.size;
  }

  join(client: Client, user: User) {
    client.room = this;
    client.user = user;
    this.clients.add(client);
    this.applySystem(userActions.upsert.create({ user }));
    client.send({ t: 'welcome', self: user, state: this.state, seq: this.seq });
    this.broadcastPresence();
  }

  leave(client: Client) {
    if (!this.clients.delete(client)) return;
    client.room = null;
    this.broadcastPresence();
  }

  /** Handle an untrusted action from a client. */
  handleClientAction(client: Client, clientId: string, raw: { type: string; payload: unknown }) {
    const user = client.user;
    if (!user) return;
    const reject = (reason: string) => client.send({ t: 'reject', clientId, reason });

    const parsed = parseAction(raw);
    if (!parsed.ok) return reject(parsed.error);
    const { def } = parsed;
    let payload = parsed.action.payload;

    try {
      const auth = def.authorize({ state: this.state, user }, payload);
      if (auth !== true) return reject(auth);
      if (def.prepare) payload = def.prepare({ state: this.state, user, random: randomInt }, payload);
    } catch (e) {
      console.error(`[room ${this.id}] error preparing ${def.type}`, e);
      return reject('Server error');
    }

    this.commit({ type: def.type, payload }, { userId: user.id, ts: Date.now() }, client, clientId);
  }

  /** Apply an action on behalf of the server, bypassing authorization. */
  applySystem(action: GameAction) {
    const parsed = parseAction(action);
    if (!parsed.ok) throw new Error(`Invalid system action: ${parsed.error}`);
    this.commit(parsed.action, { userId: SYSTEM_USER_ID, ts: Date.now() });
  }

  broadcastEphemeral(from: Client, event: EphemeralEvent) {
    if (!from.user) return;
    const msg: ServerMessage = { t: 'ephemeral', from: from.user.id, event };
    for (const c of this.clients) if (c !== from) c.send(msg);
  }

  private commit(action: Action, meta: ActionMeta, origin?: Client, clientId?: string) {
    this.state = applyAction(this.state, action, meta);
    this.seq++;
    const base = { t: 'action', seq: this.seq, action, meta } as const;
    for (const c of this.clients) c.send(c === origin ? { ...base, clientId } : base);
    this.scheduleSave();
  }

  private broadcastPresence() {
    const online = [...new Set([...this.clients].map((c) => c.user?.id).filter((id): id is string => !!id))];
    for (const c of this.clients) c.send({ t: 'presence', online });
  }

  private scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, config.saveDebounceMs);
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.store.save(this.id, this.state);
    } catch (e) {
      this.dirty = true;
      console.error(`[room ${this.id}] save failed`, e);
    }
  }
}
