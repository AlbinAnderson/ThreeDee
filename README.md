# Tabletop

A small, system-agnostic virtual tabletop: shared maps with a grid, tokens, drawing, a measuring ruler, pings, chat, dice rolled on the server, per-player notepads, and a party loot tracker. It's built to be extended. Game-system features (Pathfinder 1e helpers and so on) can be added as new modules without touching the core.

## Running locally

Requires Node 22+ (tested on Node 24).

```bash
npm install
npm run dev          # server on :3001 + Vite client on :5173
```

Open http://localhost:5173. Join with a name and room (default `main`), and tick **Join as GM** for yourself. Open a second browser window (or a private window, since each one keeps its own identity) to test as a player. Vite also listens on your LAN, so people on your network can join at `http://<your-ip>:5173`.

Everything is stored in `./data/` (git-ignored): the SQLite database `vtt.db` (all rooms and their snapshot history) and `assets/` (uploaded images). Back up the whole folder.

`npm test` runs the server test suite (storage, snapshots, restore).

### Controls

| Action | How |
|---|---|
| Pan | Drag empty space (Select tool), right/middle drag, or Space + drag |
| Zoom | Mouse wheel, or the toolbar's − / + / fit buttons |
| Select / move token | Click / drag. Shift-click adds to the selection. Hold Alt while dropping to skip snapping |
| Delete token | Select it, press Delete |
| Tools | `V` select, `R` ruler (Alt = no snapping), `P` ping, `D` draw, `E` erase |
| Draw | Pen, line, rectangle, ellipse; color, width and fill in the bar under the toolbar. Everyone can draw on the live scene and erase their own drawings; the GM can erase any and "Clear all" |
| Dice | `/r 1d20+5 # Attack`, `/r 4d6kh3`, `/r 2d20kl1`, `/r d%`, or the quick-dice buttons |

Sidebar tabs:
- **Players**: the roster. Click a player to open their page. Your page has your name, color and a private **notepad** (autosaves; only you and the GM can see it).
- **Status**: empty for now, ready for HP, conditions and so on.
- **Loot**: anyone can add items (image, quantity, value, who's carrying it, party notes). The GM also writes each item's **true properties**, which players can't see until the GM ticks *Identified*. **Export…** downloads everything as CSV, Markdown or JSON.

GM only: the **History** tab (save a labelled snapshot, or restore the room to any earlier snapshot; restores are undoable), the **Scenes** tab (create scenes, upload maps, grid settings, "Show players"), hiding tokens, and assigning token owners. The GM can preview a scene privately; players only see the LIVE scene.

The ruler's diagonal rule is set per scene. Pick **Alternating (1-2-1-2)** for PF1e's 5/10/5 counting.

## Production / the droplet

```bash
npm run build                          # builds the client into packages/client/dist
GM_PASSWORD=something PORT=3001 npm start
```

In production a single Node process serves the client, the WebSocket (`/ws`), and uploads (`/assets`). Put it behind Caddy or nginx for HTTPS, and make sure WebSocket upgrades are proxied. With Caddy that's just `vtt.example.com { reverse_proxy localhost:3001 }`. Run it under systemd or pm2.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3001` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `<repo>/data` | Database (`vtt.db`), uploads (`assets/`), backups (`backups/`) |
| `SNAPSHOT_INTERVAL_MIN` | `60` | How often a room in use is snapshotted automatically |
| `GM_PASSWORD` | unset | Required to join as GM. **If unset, anyone can be GM.** Set it before exposing the server. |
| `MAX_UPLOAD_MB` | `30` | Upload size limit |

### Persistence, snapshots and backups

Rooms live in SQLite (`data/vtt.db`, built into Node, so there's no database server to run). The server saves a room about 1 second after each change, and flushes everything on shutdown (Ctrl+C, SIGTERM, `tsx watch` restarts).

**Snapshots:** each room is snapshotted automatically when it's in use (at most hourly). Automatic snapshots are kept for 2 days, then thinned to one per day for 30 days. Snapshots the GM saves by hand are kept forever. Restoring first snapshots the current state, so you can undo a restore.

Maintenance commands (run from the repo root):

```bash
npm run -s vtt -- rooms                  # list rooms
npm run -s vtt -- snapshots main         # list a room's snapshots
npm run -s vtt -- backup                 # data/backups/vtt-<date>.db; safe while the server runs
npm run -s vtt -- export main [file]     # room as JSON
npm run -s vtt -- import file.json main  # load JSON into a room (stop the server first)
```

On the droplet, schedule a nightly backup and copy it off the machine, e.g. with cron: `0 5 * * * cd /srv/vtt && npm run -s vtt -- backup`. Don't copy `vtt.db` by hand while the server is running, because recent writes may still be in `vtt.db-wal`; use `backup`.

Rooms saved by the old JSON store (`data/rooms/*.json`) are imported automatically on startup and the files renamed to `*.json.imported`.

Known trust limits, which are fine among friends but worth knowing: identity is a random ID stored in the browser (no accounts), uploads aren't authenticated, and hidden tokens are sent to every client and simply not drawn for players. Notes and unidentified loot properties, by contrast, are genuinely private: the server never sends them to other players (see *Private data* below).

## Architecture

```
packages/
  shared/   Game logic used by both sides: state schemas, actions, dice, geometry, protocol
  server/   Node + Express + ws. Authoritative rooms, persistence, asset uploads
  client/   React + Vite + zustand. SVG board, tools, panels
```

**The core idea:** every change to the game is an *action* defined exactly once in `shared` with `defineAction(type, zodSchema, { authorize, prepare?, apply })`.

1. The client calls `dispatch(action)`. It validates and authorizes locally for instant feedback, then applies the action optimistically.
2. The server re-validates the payload with the same zod schema and the same `authorize`. It optionally runs `prepare` (dice are rolled here, so clients can't fake them), then applies the action with the **same `apply` reducer** and broadcasts it with a sequence number.
3. Clients apply the confirmed action and drop their optimistic copy. If the server rejects it, the client rolls back and shows a toast.

Because the reducer is shared, client and server can't drift apart. Ephemeral things like pings use a separate relay channel and are never stored.

### Private data

Some data must never reach certain players (another player's notes, unidentified loot). Two hooks handle it:

- A module may export a **redactor** `(draft, viewer) => void` that strips hidden data from a snapshot before the server sends it to that viewer (see `modules/notes.ts`, `modules/loot.ts`).
- An action may declare an **`audience(viewer, payload, { state, meta })`**. The server only delivers it to matching users (the author always gets their own). An action with a restricted audience must only touch data the redactor hides; otherwise excluded clients' state drifts.

To reveal a secret later, have a server `prepare` step copy it into an everyone-audience action (that's how `loot/setIdentified` works).

### Where things live

| Concern | Location |
|---|---|
| State shape (zod → TS types) | `shared/src/state.ts` |
| Feature actions | `shared/src/modules/*.ts`, registered in `modules/index.ts` |
| Permission helpers | `shared/src/actions/auth.ts` |
| Save-format migrations | `shared/src/migrations.ts` |
| Wire protocol | `shared/src/protocol.ts` |
| Room logic | `server/src/rooms/Room.ts` |
| Persistence | `server/src/persistence/`: `RoomStore` interface, `SqliteRoomStore` (DB schema migrations at the top), `snapshotPolicy` |
| Request/response ops (snapshots...) | `shared/src/rpc.ts` (types) + `server/src/rpc.ts` (handlers) + client `net/rpc.ts` |
| Maintenance CLI | `server/src/cli.ts` |
| Client stores | `client/src/state/` (`gameStore` = synced, `uiStore` = local, `board/interactionStore` = transient) |
| Board layers | `client/src/board/layers/`, registered in `layers/index.ts` |
| Tools | `client/src/tools/`, registered in `tools/index.ts` |
| Sidebar tabs | `client/src/panels/`, registered in `panels/index.ts` |
| Player page sections (notes, ...) | `client/src/player/`, registered in `player/index.ts` |
| Status tab sections | `client/src/status/index.ts` |
| Loot UI + exporters | `client/src/loot/` |

## Extending it: recipes

**Add a synced feature** (for example initiative tracking):
1. Add the data to `GameStateSchema` in `shared/src/state.ts`. If existing saves need it, bump `CURRENT_SCHEMA_VERSION` and add a migration step.
2. Create `shared/src/modules/initiative.ts` exporting `{ add: defineAction(...), next: ... }` and add it to `gameModules`. `GameAction` and server handling pick it up automatically.
3. Add a panel in `client/src/panels/` and register it in `panels/index.ts`. Use `useGame(s => s.initiative)` to read and `dispatch(initiativeActions.next.create({...}))` to write.

**Add a board tool:** write `defineTool({ id, label, icon, hotkey, createState, onPointerDown/Move/Up })` and list it in `tools/index.ts`. It gets a toolbar button and its hotkey automatically. Give it an `Options` component to show settings under the toolbar while it's active (see `drawTool.tsx`).

**Add something to each player's page** (character info, inventory...): write a component taking `{ player, viewer, isSelf }` and add `{ id, title, visible?, Component }` to `player/index.ts`. For per-player synced data, key a state slice by user id, as `notes` does. If it's private, add a redactor and an audience.

**Add something to the Status tab:** add `{ id, title, gmOnly?, Component }` to `status/index.ts`.

**Add a server request** (something that isn't a game-state change, e.g. a search or an admin operation): add the args schema and result type in `shared/src/rpc.ts`, a handler in `server/src/rpc.ts`, and call `await request('your.op', args)` on the client.

**Change the database schema:** append a SQL step to `MIGRATIONS` in `SqliteRoomStore.ts`; never edit an existing one. (Game-state shape changes go through `shared/src/migrations.ts` instead.)

**Add a loot export format:** add an entry to `lootExporters` in `loot/exportLoot.ts`.

**Add a visual layer** (fog, drawings, AoE templates): write a component taking `{ scene }` and add it to `boardLayers` in draw order.

**Add an ephemeral event** (shared cursors, a shared ruler): add a variant to `EphemeralEventSchema`, then send it with `sendEphemeral(...)` and subscribe with `onEphemeral(kind, handler)`.

**System-specific features** (PF1e) can live in their own `shared/src/modules/pf1e/*` and `client/src/panels/pf1e/*` files, or later in a separate `packages/pf1e` workspace. Either way, the core stays generic.

### Conventions

- `useGame(selector)` selectors must return existing objects. To get a derived array, select the source record and derive it with `useMemo`, otherwise React re-renders forever.
- Form fields in `components/fields.tsx` commit on blur or Enter, so typing doesn't flood the server.
- `npm run typecheck` checks all three packages.
