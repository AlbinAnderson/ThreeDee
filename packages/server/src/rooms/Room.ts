import { randomInt } from 'node:crypto';
import {
  ActionRejection,
  applyAction,
  NO_RULES,
  getActionDef,
  parseAction,
  redactState,
  userActions,
  type Action,
  type ActionMeta,
  type EphemeralEvent,
  type GameAction,
  type GameState,
  type RulesProvider,
  type ServerMessage,
  type SnapshotInfo,
  type SnapshotReason,
  type User,
} from '@vtt/shared';
import type { RoomStore } from '../persistence/RoomStore';
import { shouldAutoSnapshot, snapshotsToPrune, type SnapshotPolicy } from '../persistence/snapshotPolicy';
import { config } from '../config';

/** A connected socket, independent of the transport. */
export interface Client {
  readonly id: string;
  user: User | null;
  room: Room | null;
  /** Number of actions sent to this client (clients see different subsets). */
  seq: number;
  send(msg: ServerMessage): void;
}

export const SYSTEM_USER_ID = 'system';

/**
 * Authoritative state for one game room. All mutations go through `commit`,
 * which applies the shared reducer, sequences the action and broadcasts it.
 */
export class Room {
  private readonly clients = new Set<Client>();
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    readonly id: string,
    private state: GameState,
    private readonly store: RoomStore,
    private readonly snapshotPolicy: SnapshotPolicy = config.snapshotPolicy,
    /** The server's rules pack (Epic 11), handed to action prepare() for prices and spell cards. */
    private readonly rules: () => RulesProvider = () => NO_RULES,
  ) {}

  get currentState(): GameState {
    return this.state;
  }

  get clientCount() {
    return this.clients.size;
  }

  join(client: Client, user: User) {
    client.room = this;
    client.user = user;
    client.seq = 0;
    this.clients.add(client);
    this.applySystem(userActions.upsert.create({ user }));
    this.sendWelcome(client);
    this.broadcastPresence();
  }

  private sendWelcome(client: Client) {
    if (!client.user) return;
    client.seq = 0;
    client.send({ t: 'welcome', self: client.user, state: redactState(this.state, client.user), seq: 0, serverTime: Date.now() });
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
      if (def.prepare) payload = def.prepare({ state: this.state, user, random: randomInt, rules: this.rules() }, payload);
    } catch (e) {
      if (e instanceof ActionRejection) return reject(e.message);
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
    const prev = this.state;
    this.state = applyAction(prev, action, meta);
    const def = getActionDef(action.type);
    const audience = def?.audience;
    const redactPayload = def?.redactPayload;
    for (const c of this.clients) {
      if (!c.user) continue;
      if (c !== origin && audience && !audience(c.user, action.payload, { state: prev, meta })) continue;
      const outAction = c !== origin && redactPayload ? { ...action, payload: redactPayload(c.user, action.payload, { state: prev, meta }) } : action;
      c.seq++;
      c.send({ t: 'action', seq: c.seq, action: outAction, meta, ...(c === origin ? { clientId } : {}) });
    }
    this.scheduleSave();
  }

  broadcastNotice(message: string) {
    for (const c of this.clients) c.send({ t: 'notice', message });
  }

  // ------------------------------------------------------------ snapshots

  listSnapshots(): Promise<SnapshotInfo[]> {
    return this.store.listSnapshots(this.id);
  }

  createSnapshot(reason: SnapshotReason, label: string | null): Promise<SnapshotInfo> {
    return this.store.createSnapshot(this.id, this.state, reason, label);
  }

  /**
   * Replace the room with a snapshot. The current state is snapshotted first,
   * so a restore can itself be undone. Connected users are kept in the
   * restored state, and every client is re-sent a full welcome.
   */
  async restore(snapshotId: number, by: User) {
    const restored = await this.store.loadSnapshot(this.id, snapshotId);
    if (!restored) throw new Error('Snapshot not found');
    await this.createSnapshot('pre-restore', `Before restoring #${snapshotId}`);

    let state = restored;
    for (const c of this.clients) {
      if (c.user) state = applyAction(state, userActions.upsert.create({ user: c.user }), { userId: SYSTEM_USER_ID, ts: Date.now() });
    }
    this.state = state;
    this.dirty = true;
    await this.flush({ autoSnapshot: false });

    for (const c of this.clients) this.sendWelcome(c);
    this.broadcastPresence();
    this.broadcastNotice(`${by.name} restored the room to snapshot #${snapshotId}`);
    console.log(`[room ${this.id}] restored snapshot #${snapshotId} (by ${by.name})`);
  }

  /** Take an automatic snapshot if the newest one is old enough, and thin out old ones. */
  async maybeAutoSnapshot() {
    try {
      const now = Date.now();
      const snapshots = await this.store.listSnapshots(this.id);
      if (shouldAutoSnapshot(snapshots[0], now, this.snapshotPolicy)) {
        snapshots.unshift(await this.createSnapshot('auto', null));
      }
      await this.store.deleteSnapshots(snapshotsToPrune(snapshots, now, this.snapshotPolicy));
    } catch (e) {
      console.error(`[room ${this.id}] automatic snapshot failed`, e);
    }
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

  async flush({ autoSnapshot = true } = {}) {
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
      return;
    }
    if (autoSnapshot) await this.maybeAutoSnapshot();
  }
}
