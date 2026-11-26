# Tabletop

A small, system-agnostic virtual tabletop: shared maps with a grid, tokens, a measuring ruler, pings, chat, and dice rolled on the server. It's built to be extended. Game-system features (Pathfinder 1e helpers and so on) can be added as new modules without touching the core.

## Running locally

Requires Node 22+ (tested on Node 24).

```bash
npm install
npm run dev          # server on :3001 + Vite client on :5173
```

Open http://localhost:5173. Join with a name and room (default `main`), and tick **Join as GM** for yourself. Open a second browser window (or a private window, since each one keeps its own identity) to test as a player. Vite also listens on your LAN, so people on your network can join at `http://<your-ip>:5173`.

Room data and uploaded images are stored in `./data/`, which is git-ignored. Back it up.

### Controls

| Action | How |
|---|---|
| Pan | Drag empty space (Select tool), right/middle drag, or Space + drag |
| Zoom | Mouse wheel, or the toolbar's − / + / fit buttons |
| Select / move token | Click / drag. Shift-click adds to the selection. Hold Alt while dropping to skip snapping |
| Delete token | Select it, press Delete |
| Tools | `V` select, `R` ruler (Alt = no snapping), `P` ping |
| Dice | `/r 1d20+5 # Attack`, `/r 4d6kh3`, `/r 2d20kl1`, `/r d%`, or the quick-dice buttons |

GM only: the **Scenes** tab (create scenes, upload maps, grid settings, "Show players"), hiding tokens, and assigning token owners. The GM can preview a scene privately; players only see the LIVE scene.

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
| `DATA_DIR` | `<repo>/data` | Rooms (`rooms/*.json`) and uploads (`assets/`) |
| `GM_PASSWORD` | unset | Required to join as GM. **If unset, anyone can be GM.** Set it before exposing the server. |
| `MAX_UPLOAD_MB` | `30` | Upload size limit |

Known trust limits, which are fine among friends but worth knowing: identity is a random ID stored in the browser (no accounts), uploads aren't authenticated, and hidden tokens are sent to every client and simply not drawn for players.

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

### Where things live

| Concern | Location |
|---|---|
| State shape (zod → TS types) | `shared/src/state.ts` |
| Feature actions | `shared/src/modules/*.ts`, registered in `modules/index.ts` |
| Permission helpers | `shared/src/actions/auth.ts` |
| Save-format migrations | `shared/src/migrations.ts` |
| Wire protocol | `shared/src/protocol.ts` |
| Room logic / persistence | `server/src/rooms/Room.ts`, `server/src/persistence/RoomStore.ts` (swappable interface) |
| Client stores | `client/src/state/` (`gameStore` = synced, `uiStore` = local, `board/interactionStore` = transient) |
| Board layers | `client/src/board/layers/`, registered in `layers/index.ts` |
| Tools | `client/src/tools/`, registered in `tools/index.ts` |
| Sidebar tabs | `client/src/panels/`, registered in `panels/index.ts` |

## Extending it: recipes

**Add a synced feature** (for example initiative tracking):
1. Add the data to `GameStateSchema` in `shared/src/state.ts`. If existing saves need it, bump `CURRENT_SCHEMA_VERSION` and add a migration step.
2. Create `shared/src/modules/initiative.ts` exporting `{ add: defineAction(...), next: ... }` and add it to `gameModules`. `GameAction` and server handling pick it up automatically.
3. Add a panel in `client/src/panels/` and register it in `panels/index.ts`. Use `useGame(s => s.initiative)` to read and `dispatch(initiativeActions.next.create({...}))` to write.

**Add a board tool:** write `defineTool({ id, label, icon, hotkey, createState, onPointerDown/Move/Up })` and list it in `tools/index.ts`. It gets a toolbar button and its hotkey automatically.

**Add a visual layer** (fog, drawings, AoE templates): write a component taking `{ scene }` and add it to `boardLayers` in draw order.

**Add an ephemeral event** (shared cursors, a shared ruler): add a variant to `EphemeralEventSchema`, then send it with `sendEphemeral(...)` and subscribe with `onEphemeral(kind, handler)`.

**System-specific features** (PF1e) can live in their own `shared/src/modules/pf1e/*` and `client/src/panels/pf1e/*` files, or later in a separate `packages/pf1e` workspace. Either way, the core stays generic.

### Conventions

- `useGame(selector)` selectors must return existing objects. To get a derived array, select the source record and derive it with `useMemo`, otherwise React re-renders forever.
- Form fields in `components/fields.tsx` commit on blur or Enter, so typing doesn't flood the server.
- `npm run typecheck` checks all three packages.
