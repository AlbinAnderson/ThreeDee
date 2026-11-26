import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessageSchema, newId, pickUserColor, type JoinMessage, type Role } from '@vtt/shared';
import { config } from '../config';
import type { Client } from '../rooms/Room';
import type { RoomManager } from '../rooms/RoomManager';
import { handleRequest } from '../rpc';

const HEARTBEAT_MS = 30_000;

export function attachWebSocket(server: Server, rooms: RoomManager) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    const client: Client = {
      id: newId(),
      user: null,
      room: null,
      seq: 0,
      send(msg) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    let joining = false;

    const fail = (message: string) => {
      client.send({ t: 'error', message, fatal: true });
      ws.close();
    };

    async function handleJoin(msg: JoinMessage) {
      if (client.room || joining) return;
      joining = true;
      try {
        let role: Role = 'player';
        if (msg.asGm) {
          if (config.gmPassword && msg.gmPassword !== config.gmPassword) return fail('Incorrect GM password');
          role = 'gm';
        }
        const room = await rooms.get(msg.roomId);
        if (ws.readyState !== WebSocket.OPEN) return;
        const existing = room.currentState.users[msg.userId];
        room.join(client, {
          id: msg.userId,
          name: msg.name.trim(),
          role,
          color: existing?.color ?? pickUserColor(msg.userId),
        });
      } catch (e) {
        console.error(`[ws] failed to join room "${msg.roomId}"`, e);
        fail('Could not load that room. Check the server logs.');
      } finally {
        joining = false;
      }
    }

    ws.on('message', (data) => {
      let msg;
      try {
        msg = ClientMessageSchema.parse(JSON.parse(String(data)));
      } catch {
        client.send({ t: 'error', message: 'Malformed message' });
        return;
      }
      switch (msg.t) {
        case 'join':
          void handleJoin(msg as JoinMessage);
          break;
        case 'action':
          if (!client.room) return client.send({ t: 'error', message: 'Join a room first' });
          client.room.handleClientAction(client, msg.clientId, msg.action);
          break;
        case 'ephemeral':
          client.room?.broadcastEphemeral(client, msg.event);
          break;
        case 'request':
          void handleRequest(client, msg.reqId, msg.op, msg.args);
          break;
      }
    });

    ws.on('close', () => client.room?.leave(client));
  });

  // Drop connections that stopped answering (laptop lid closed, wifi died...).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
